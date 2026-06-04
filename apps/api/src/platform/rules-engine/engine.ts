import { sql } from 'drizzle-orm';
import type { Db } from '@revelation-srs/db';
import { RuleNotConfiguredError } from '@revelation-srs/domain';

export type RuleTypeCode =
  | 'pass-mark'
  | 'late-penalty'
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
  | 'award-credit-requirement';

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
    const asOfDay  = (ctx.asOfDate ?? new Date()).toISOString().slice(0, 10);
    const cacheKey = `${ctx.tenantId}:${ctx.programmeId}:${ruleType}:${ruleKey}:${asOfDay}`;
    const cached   = this.cache.get(cacheKey);

    if (cached && cached.expiresAt > Date.now()) {
      return cached.value as T;
    }

    const asOf = ctx.asOfDate ?? new Date();

    // Programme-specific rule first, tenant-wide default as fallback
    const rows = await this.db.execute(
      sql`SELECT rule_value FROM academic_rule
          WHERE tenant_id = ${ctx.tenantId}
            AND rule_type_code = ${ruleType}
            AND rule_key = ${ruleKey}
            AND (programme_id = ${ctx.programmeId} OR programme_id IS NULL)
            AND valid_from <= ${asOf}
            AND (valid_to IS NULL OR valid_to > ${asOf})
            AND recorded_until IS NULL
          ORDER BY programme_id NULLS LAST
          LIMIT 1`,
    ) as unknown as RuleRow[];

    if (rows.length === 0) {
      throw new RuleNotConfiguredError(
        `${ruleType}:${ruleKey}`,
        `programme=${ctx.programmeId} tenant=${ctx.tenantId}`,
      );
    }

    const value = rows[0]?.rule_value as T;
    this.cache.set(cacheKey, { value, expiresAt: Date.now() + 5 * 60 * 1000 });
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
}
