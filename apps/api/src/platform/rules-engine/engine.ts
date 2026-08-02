import { sql } from 'drizzle-orm';
import { withTenantContext, type Db } from '@revelation-srs/db';
import { RuleNotConfiguredError } from '@revelation-srs/domain';

import { clockNow } from '../clock.js';

export type RuleTypeCode =
  | 'pass-mark'
  | 'late-penalty'
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

export interface RuleContext {
  tenantId:    string;
  programmeId: string;
  asOfDate?:   Date;
}

interface RuleRow {
  rule_value: unknown;
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
  ): Promise<T> {
    // Include date in cache key so historical and current lookups are separate entries
    const asOfDay  = (ctx.asOfDate ?? clockNow()).toISOString().slice(0, 10);
    const cacheKey = `${ctx.tenantId}:${ctx.programmeId}:${ruleType}:${ruleKey}:${asOfDay}`;
    const cached   = this.cache.get(cacheKey);

    if (cached && cached.expiresAt > Date.now()) {  // clock:allow
      return cached.value as T;
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
        sql`SELECT rule_value FROM academic_rule
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

    if (rows.length === 0) {
      throw new RuleNotConfiguredError(
        `${ruleType}:${ruleKey}`,
        `programme=${ctx.programmeId} tenant=${ctx.tenantId}`,
      );
    }

    const value = rows[0]?.rule_value as T;
    this.cache.set(cacheKey, { value, expiresAt: Date.now() + 5 * 60 * 1000 });  // clock:allow
    return value;
  }

  /** Invalidate cache for a tenant (call when a rule is updated). */
  invalidateTenant(tenantId: string): void {
    for (const key of this.cache.keys()) {
      if (key.startsWith(`${tenantId}:`)) {
        this.cache.delete(key);
      }
    }
  }

  async getPassMark(ctx: RuleContext): Promise<number> {
    const rule = await this.getRule<{ mark: number }>(ctx, 'pass-mark', 'undergraduate-default');
    return rule.mark;
  }

  async getResitMarkCap(ctx: RuleContext): Promise<number> {
    const rule = await this.getRule<{ cap: number }>(ctx, 'resit-mark-cap', 'default');
    return rule.cap;
  }

  async getClassificationBoundaries(ctx: RuleContext): Promise<Array<{ code: string; minimumMark: number }>> {
    const rule = await this.getRule<{ boundaries: Array<{ code: string; minimumMark: number }> }>(
      ctx, 'classification-boundary', 'undergraduate',
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
   * by mode of study (falls back to 'default' if no mode-specific rule is
   * configured). Returns null if no rule is configured for either key.
   */
  async getCreditLoadRequirement(
    ctx: RuleContext,
    modeOfStudyCode: string,
  ): Promise<{ minCredits: number | null; maxCredits: number | null } | null> {
    for (const ruleKey of [modeOfStudyCode, 'default']) {
      try {
        return await this.getRule<{ minCredits: number | null; maxCredits: number | null }>(
          ctx, 'credit-load-requirement', ruleKey,
        );
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
