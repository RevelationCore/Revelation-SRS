import { and, desc, eq, sql } from 'drizzle-orm';
import { ruleExceptions, tenants, withTenantContext, type Db } from '@revelation-srs/db';
import { RuleNotConfiguredError } from '@revelation-srs/domain';

import { clockNow } from '../clock.js';

export type RuleTypeCode =
  | 'pass-mark'
  | 'late-penalty-rate'
  | 'late-penalty-cap'
  | 'resit-mark-cap'
  | 'compensation-threshold'
  | 'compensation-credit-limit'
  | 'condonement-threshold'
  | 'progression-credit-requirement'
  | 'progression-pass-requirement'
  | 'classification-boundary'
  | 'classification-algorithm'
  | 'classification-discretion-zone'
  | 'award-credit-requirement'
  | 'max-credits-per-period'
  | 'ukvi-attendance-threshold'
  | 'credit-load-requirement'
  | 'level-credit-requirement'
  | 'adjacent-level-credit-limit'
  | 'joint-honours-balance'
  | 'repeat-module-requirement'
  | 'timetable-clash-policy';

export type RuleDomain = 'selection' | 'assessment' | 'progression' | 'award' | 'regulatory';

/**
 * Which process consumes each rule type (Phase 4 D-23). A Record, so a new
 * rule type that is not classified fails to compile.
 */
export const RULE_TYPE_DOMAIN: Record<RuleTypeCode, RuleDomain> = {
  'max-credits-per-period':         'selection',
  'credit-load-requirement':        'selection',
  'level-credit-requirement':       'selection',
  'adjacent-level-credit-limit':    'selection',
  'joint-honours-balance':          'selection',
  'repeat-module-requirement':      'selection',
  'timetable-clash-policy':         'selection',
  'pass-mark':                      'assessment',
  'late-penalty-rate':              'assessment',
  'late-penalty-cap':               'assessment',
  'resit-mark-cap':                 'assessment',
  'compensation-threshold':         'progression',
  'compensation-credit-limit':      'progression',
  'condonement-threshold':          'progression',
  'progression-credit-requirement': 'progression',
  'progression-pass-requirement':   'progression',
  'classification-boundary':        'award',
  'classification-algorithm':       'award',
  'classification-discretion-zone': 'award',
  'award-credit-requirement':       'award',
  'ukvi-attendance-threshold':      'regulatory',
};

/** The rule types module-selection validation must enforce (the Phase 4 exit). */
export const SELECTION_RULE_TYPES = (Object.keys(RULE_TYPE_DOMAIN) as RuleTypeCode[]).filter((t) => RULE_TYPE_DOMAIN[t] === 'selection');

/**
 * Rules evaluated for one student, which an approved rule exception
 * (BPR-D05) may waive or vary. Each lists the value fields a variation may
 * set; a variation's value merges over the programme rule's value.
 */
export const ENROLMENT_RULE_FIELDS = {
  'max-credits-per-period':         ['maxCredits'],
  'credit-load-requirement':        ['minCredits', 'maxCredits'],
  'level-credit-requirement':       ['minCreditsAtLevel'],
  'adjacent-level-credit-limit':    ['maxCredits'],
  'progression-credit-requirement': ['requiredCredits'],
  'compensation-credit-limit':      ['maxCredits'],
  // Phase 4 D-33. An empty list means the rule can only be waived.
  'joint-honours-balance':          ['tolerancePercent'],
  'repeat-module-requirement':      ['maxRepeatCredits'],
  'timetable-clash-policy':         [],
} as const satisfies Partial<Record<RuleTypeCode, readonly string[]>>;

export type EnrolmentRuleType = keyof typeof ENROLMENT_RULE_FIELDS;

export interface AppliedRuleException {
  exceptionId: string;
  ruleCode: EnrolmentRuleType;
  exceptionTypeCode: 'waiver' | 'variation';
}

export interface RuleContext {
  tenantId:    string;
  programmeId: string;
  asOfDate?:   Date;
}

interface RuleRow {
  id: string;
  version_id: string;
  programme_id: string | null;
  valid_from: Date | string;
  rule_value: unknown;
}

/** Where a value a calculation used came from (Phase 5 D-35). */
export type RuleSource =
  | 'programme'
  | 'tenant-default'
  | 'exception'
  | 'component-override'
  | 'built-in-default'
  | 'reassessment-plan';

/** One rule a calculation used, citing the exact academic_rule version. */
export interface RuleVersionCitation {
  ruleTypeCode: string;
  ruleKey: string | null;
  ruleId: string | null;
  versionId: string | null;
  programmeId: string | null;
  validFrom: string | null;
  source: RuleSource;
  value: unknown;
  exceptionId?: string;
  componentId?: string;
  planId?: string;
}

export interface RuleWithProvenance<T> {
  value: T;
  ruleId: string;
  versionId: string;
  programmeId: string | null;
  validFrom: string;
  source: 'programme' | 'tenant-default';
}

/**
 * The rules one calculation used (D-35): every configured rule read, every
 * exception, component override and built-in fallback. Stored with the
 * result as `rule_versions`, so a result can be traced to the bitemporal
 * academic_rule rows that produced it.
 */
export class RuleTrace {
  readonly #entries = new Map<string, RuleVersionCitation>();

  cite(citation: RuleVersionCitation): void {
    const key = [citation.ruleTypeCode, citation.ruleKey, citation.versionId, citation.source, citation.exceptionId, citation.componentId, citation.planId].join('|');
    if (!this.#entries.has(key)) this.#entries.set(key, citation);
  }

  merge(other: RuleTrace | RuleVersionCitation[]): void {
    for (const c of Array.isArray(other) ? other : other.entries) this.cite(c);
  }

  get entries(): RuleVersionCitation[] {
    return [...this.#entries.values()];
  }

  /** The cited academic_rule version ids, sorted, for comparing two calculations. */
  versionIds(): string[] {
    return this.entries.map((e) => e.versionId).filter((v): v is string => v !== null).sort();
  }
}

function citationOf<T>(ruleType: string, ruleKey: string, p: RuleWithProvenance<T>): RuleVersionCitation {
  return { ruleTypeCode: ruleType, ruleKey, ruleId: p.ruleId, versionId: p.versionId, programmeId: p.programmeId, validFrom: p.validFrom, source: p.source, value: p.value };
}

/**
 * Evaluates configured institutional business rules.
 *
   * Rules are stored bitemporally in the academic_rule table. Programme-specific
   * rules take precedence over tenant-wide defaults.
 *
 * See docs/architecture/configuration-rules-framework.md.
 */
export class RulesEngine {
  // In-memory cache per tenant, 5 minute TTL
  private cache = new Map<string, { value: unknown; expiresAt: number }>();

  constructor(private readonly db: Db) {}

  async getRule<T>(
    ctx:      RuleContext,
    ruleType: RuleTypeCode,
    ruleKey:  string,
    trace?:   RuleTrace,
  ): Promise<T> {
    const p = await this.getRuleWithProvenance<T>(ctx, ruleType, ruleKey);
    trace?.cite(citationOf(ruleType, ruleKey, p));
    return p.value;
  }

  /**
   * A rule's value with the exact academic_rule row and version it came
   * from (D-35). Programme rules take precedence over tenant defaults.
   */
  async getRuleWithProvenance<T>(
    ctx:      RuleContext,
    ruleType: RuleTypeCode,
    ruleKey:  string,
  ): Promise<RuleWithProvenance<T>> {
    // Include date in cache key so historical and current lookups are separate entries
    const asOfDay  = (ctx.asOfDate ?? clockNow()).toISOString().slice(0, 10);
    const cacheKey = `${ctx.tenantId}:${ctx.programmeId}:${ruleType}:${ruleKey}:${asOfDay}`;
    const cached   = this.cache.get(cacheKey);

    if (cached && cached.expiresAt > Date.now()) {  // clock:allow
      return cached.value as RuleWithProvenance<T>;
    }

    const asOf = ctx.asOfDate ?? clockNow();

    // Build programme filter: if a programmeId is provided, match it first
    // (programme-specific rule takes precedence) then fall back to tenant-wide
    // defaults (programme_id IS NULL). When no programmeId is set, only look
    // for tenant-wide defaults to avoid a UUID type error on empty string.
    const programmeCondition = ctx.programmeId
      ? sql`(programme_id = ${ctx.programmeId}::uuid OR programme_id IS NULL)`
      : sql`programme_id IS NULL`;

    const rows = await withTenantContext(this.db, ctx.tenantId, async (tx) =>
      tx.execute(
        sql`SELECT id, version_id, programme_id, valid_from, rule_value FROM academic_rule
            WHERE tenant_id = ${ctx.tenantId}
              AND rule_type_code = ${ruleType}
              AND rule_key = ${ruleKey}
              AND ${programmeCondition}
              AND valid_from <= ${asOf}
              AND (valid_to IS NULL OR valid_to > ${asOf})
              AND recorded_until IS NULL
            ORDER BY programme_id NULLS LAST
            LIMIT 1`,
      ),
    ) as unknown as RuleRow[];

    const row = rows[0];
    if (!row) {
      throw new RuleNotConfiguredError(
        `${ruleType}:${ruleKey}`,
        `programme=${ctx.programmeId} tenant=${ctx.tenantId}`,
      );
    }

    const result: RuleWithProvenance<T> = {
      value: row.rule_value as T,
      ruleId: row.id,
      versionId: row.version_id,
      programmeId: row.programme_id,
      validFrom: new Date(row.valid_from).toISOString(),
      source: row.programme_id ? 'programme' : 'tenant-default',
    };
    this.cache.set(cacheKey, { value: result, expiresAt: Date.now() + 5 * 60 * 1000 });  // clock:allow
    return result;
  }

  /**
   * A built-in value used because no rule is configured (D-35). Recorded in
   * the trace as `built-in-default`; refused with RuleNotConfiguredError when
   * the tenant sets `rules.builtInDefaults` to `refuse`.
   */
  async builtInDefault<T>(ctx: RuleContext, ruleType: RuleTypeCode, ruleKey: string, value: T, trace?: RuleTrace): Promise<T> {
    if (await this.#refusesBuiltInDefaults(ctx.tenantId)) {
      throw new RuleNotConfiguredError(`${ruleType}:${ruleKey}`, `programme=${ctx.programmeId} tenant=${ctx.tenantId} (built-in defaults refused)`);
    }
    trace?.cite({ ruleTypeCode: ruleType, ruleKey, ruleId: null, versionId: null, programmeId: null, validFrom: null, source: 'built-in-default', value });
    return value;
  }

  /** The configured rule, or the built-in value when none is configured (recorded as such). */
  async getRuleOrDefault<T>(ctx: RuleContext, ruleType: RuleTypeCode, ruleKey: string, fallback: T, trace?: RuleTrace): Promise<T> {
    try {
      return await this.getRule<T>(ctx, ruleType, ruleKey, trace);
    } catch (err) {
      if (!(err instanceof RuleNotConfiguredError)) throw err;
      return this.builtInDefault(ctx, ruleType, ruleKey, fallback, trace);
    }
  }

  async #refusesBuiltInDefaults(tenantId: string): Promise<boolean> {
    const [row] = await this.db.select({ configuration: tenants.configuration }).from(tenants)
      .where(eq(tenants.id, tenantId as `${string}-${string}-${string}-${string}-${string}`)).limit(1);
    const rules = (row?.configuration?.['rules'] ?? {}) as Record<string, unknown>;
    return rules['builtInDefaults'] === 'refuse';
  }

  /** Invalidate cache for a tenant (call when a rule is updated). */
  invalidateTenant(tenantId: string): void {
    for (const key of this.cache.keys()) {
      if (key.startsWith(`${tenantId}:`)) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Resolves an enrolment-scoped rule: an approved rule exception in force
   * on the context date wins (a waiver means no rule applies; a variation's
   * value merges over the programme rule), otherwise the programme rule.
   * Returns which exception, if any, was applied, so callers can record it.
   */
  async resolveForEnrolment<T extends Record<string, unknown>>(
    ctx: RuleContext,
    ruleType: EnrolmentRuleType,
    enrolmentId: string,
    programmeRule: () => Promise<T | null>,
    trace?: RuleTrace,
  ): Promise<{ value: T | null; exception: AppliedRuleException | null }> {
    const onDate = (ctx.asOfDate ?? clockNow()).toISOString().slice(0, 10);
    const rows = await withTenantContext(this.db, ctx.tenantId, (tx) => tx.select().from(ruleExceptions).where(and(
      eq(ruleExceptions.tenantId, ctx.tenantId as `${string}-${string}-${string}-${string}-${string}`),
      eq(ruleExceptions.enrolmentId, enrolmentId as `${string}-${string}-${string}-${string}-${string}`),
      eq(ruleExceptions.ruleCode, ruleType),
      eq(ruleExceptions.statusCode, 'approved'),
      sql`${ruleExceptions.validFrom} <= ${onDate}`,
      sql`(${ruleExceptions.validTo} IS NULL OR ${ruleExceptions.validTo} > ${onDate})`,
    )).orderBy(desc(ruleExceptions.decidedAt)).limit(1));
    const exception = rows[0];
    if (!exception) return { value: await programmeRule(), exception: null };

    const applied: AppliedRuleException = {
      exceptionId: exception.id, ruleCode: ruleType, exceptionTypeCode: exception.exceptionTypeCode as 'waiver' | 'variation',
    };
    const cite = (value: unknown) => trace?.cite({
      ruleTypeCode: ruleType, ruleKey: null, ruleId: null, versionId: null, programmeId: null, validFrom: null,
      source: 'exception', exceptionId: exception.id, value,
    });
    if (exception.exceptionTypeCode === 'waiver') { cite(null); return { value: null, exception: applied }; }
    const base = await programmeRule();
    cite(exception.variationValue ?? {});
    return { value: { ...(base ?? {}), ...(exception.variationValue ?? {}) } as T, exception: applied };
  }

  async getPassMark(ctx: RuleContext, trace?: RuleTrace): Promise<number> {
    const rule = await this.getRule<{ mark: number }>(ctx, 'pass-mark', 'undergraduate-default', trace);
    return rule.mark;
  }

  async getResitMarkCap(ctx: RuleContext, trace?: RuleTrace): Promise<number> {
    const rule = await this.getRule<{ cap: number }>(ctx, 'resit-mark-cap', 'default', trace);
    return rule.cap;
  }

  async getClassificationBoundaries(ctx: RuleContext, trace?: RuleTrace): Promise<Array<{ code: string; minimumMark: number }>> {
    const rule = await this.getRule<{ boundaries: Array<{ code: string; minimumMark: number }> }>(
      ctx, 'classification-boundary', 'undergraduate', trace,
    );
    return rule.boundaries;
  }

  async getMaxCreditsPerPeriod(ctx: RuleContext): Promise<number | null> {
    try {
      const rule = await this.getRule<{ maxCredits: number }>(ctx, 'max-credits-per-period', 'per-period');
      return rule.maxCredits;
    } catch (err) {
      if (err instanceof RuleNotConfiguredError) return null;
      throw err;
    }
  }

  /**
   * Minimum/maximum total credits a student must select for a period, keyed
   * by mode of study and, for reduced-intensity study, intensity (Phase 4
   * D-31): `${mode}:${intensity}`, then `${mode}`, then 'default'. A matched
   * rule that is not intensity-specific and sets scaleByIntensity is
   * pro-rated: floor(min x i/100), ceil(max x i/100). Null if unconfigured.
   */
  async getCreditLoadRequirement(
    ctx: RuleContext,
    modeOfStudyCode: string,
    studyIntensityPercent: number | null = null,
  ): Promise<{ minCredits: number | null; maxCredits: number | null } | null> {
    const intensity = studyIntensityPercent !== null && studyIntensityPercent < 100 ? studyIntensityPercent : null;
    const keys = [...(intensity !== null ? [`${modeOfStudyCode}:${intensity}`] : []), modeOfStudyCode, 'default'];
    for (const ruleKey of keys) {
      try {
        const rule = await this.getRule<{ minCredits: number | null; maxCredits: number | null; scaleByIntensity?: boolean }>(
          ctx, 'credit-load-requirement', ruleKey,
        );
        if (intensity !== null && !ruleKey.includes(':') && rule.scaleByIntensity) {
          return {
            minCredits: rule.minCredits === null ? null : Math.floor((rule.minCredits * intensity) / 100),
            maxCredits: rule.maxCredits === null ? null : Math.ceil((rule.maxCredits * intensity) / 100),
          };
        }
        return { minCredits: rule.minCredits ?? null, maxCredits: rule.maxCredits ?? null };
      } catch (err) {
        if (!(err instanceof RuleNotConfiguredError)) throw err;
      }
    }
    return null;
  }

  /** Minimum credits that must sit at a given FHEQ level for the period. Null if unconfigured. */
  async getLevelCreditRequirement(ctx: RuleContext, fheqLevel: number): Promise<number | null> {
    try {
      const rule = await this.getRule<{ minCreditsAtLevel: number }>(
        ctx, 'level-credit-requirement', `level-${fheqLevel}`,
      );
      return rule.minCreditsAtLevel;
    } catch (err) {
      if (err instanceof RuleNotConfiguredError) return null;
      throw err;
    }
  }

  /** Maximum credits permitted from a level adjacent to the student's current level ("trailing"). Null if unconfigured. */
  async getAdjacentLevelCreditLimit(ctx: RuleContext): Promise<number | null> {
    try {
      const rule = await this.getRule<{ maxCredits: number }>(ctx, 'adjacent-level-credit-limit', 'default');
      return rule.maxCredits;
    } catch (err) {
      if (err instanceof RuleNotConfiguredError) return null;
      throw err;
    }
  }

  /** Any configured value of an optional rule, programme over tenant; null when unconfigured. */
  async getOptionalRule<T>(ctx: RuleContext, ruleType: RuleTypeCode, ruleKeys: string[], trace?: RuleTrace): Promise<T | null> {
    for (const key of ruleKeys) {
      try {
        return await this.getRule<T>(ctx, ruleType, key, trace);
      } catch (err) {
        if (!(err instanceof RuleNotConfiguredError)) throw err;
      }
    }
    return null;
  }

  /**
   * Whether a timetable clash between two chosen module offerings blocks
   * confirmation outright or is only surfaced as an advisory warning.
   * Defaults to 'advisory' if unconfigured.
   */
  async getTimetableClashPolicy(ctx: RuleContext): Promise<'advisory' | 'blocking'> {
    try {
      const rule = await this.getRule<{ policy: 'advisory' | 'blocking' }>(ctx, 'timetable-clash-policy', 'default');
      return rule.policy;
    } catch (err) {
      if (err instanceof RuleNotConfiguredError) return 'advisory';
      throw err;
    }
  }
}
