import { and, eq, gt, isNull, lte, or } from 'drizzle-orm';
import {
  fieldValueSets,
  valueSetMembers,
  valueSets,
  withTenantContext,
  type Db,
} from '@revelation-srs/db';

import { clockNow } from '../clock.js';

export interface ValueSetMemberDto {
  code:          string;
  displayLabel:  string;
  description:   string | null;
  sortOrder:     number;
  activeFrom:    string;
  activeTo:      string | null;
  sourceMetadata: Record<string, unknown> | null;
}

export interface ValueSetDto {
  setCode:       string;
  displayName:   string;
  source:        string;
  sourceVersion: string | null;
  description:   string | null;
  isExtensible:  boolean;
  members:       ValueSetMemberDto[];
}

/**
 * Provides access to valid value sets for UI dropdowns, API validation,
 * and HESA/regulatory coding lookups.
 *
 * Value sets combine platform-managed codes (statutory HESA, SLC, UCAS)
 * with tenant-specific extensions where the set is marked extensible.
 *
 * Results are cached in memory per-tenant with a configurable TTL
 * (default 10 minutes) since value sets change infrequently.
 */
export class ValueSetService {
  private cache = new Map<string, { data: ValueSetDto; expiresAt: number }>();
  private readonly ttlMs: number;

  constructor(
    private readonly db: Db,
    ttlSeconds = 600,
  ) {
    this.ttlMs = ttlSeconds * 1000;
  }

  /**
   * Fetch all value sets (without members) for a tenant - list view.
   * Platform sets are always included; extensible sets also show tenant state.
   */
  async listValueSets(): Promise<Omit<ValueSetDto, 'members'>[]> {
    const rows = await this.db.select().from(valueSets).orderBy(valueSets.displayName);
    return rows.map((r) => ({
      setCode:       r.setCode,
      displayName:   r.displayName,
      source:        r.source,
      sourceVersion: r.sourceVersion ?? null,
      description:   r.description ?? null,
      isExtensible:  r.isExtensible,
    }));
  }

  /**
   * Fetch a value set with its active members for a tenant.
   *
   * Members returned: platform values + the tenant's own extensions.
   * activeAt defaults to now - pass a past date for historical reconstruction.
   *
   * Result is cached. Pass force=true to bypass the cache.
   */
  async getValueSet(
    setCode:  string,
    tenantId: string,
    options:  { activeAt?: Date; force?: boolean } = {},
  ): Promise<ValueSetDto | null> {
    const activeAtKey = options.activeAt?.toISOString() ?? 'now';
    const cacheKey = `${setCode}:${tenantId}:${activeAtKey}`;

    if (!options.force) {
      const cached = this.cache.get(cacheKey);
      if (cached && cached.expiresAt > Date.now()) return cached.data;  // clock:allow
    }

    const setRows = await this.db
      .select()
      .from(valueSets)
      .where(eq(valueSets.setCode, setCode))
      .limit(1);

    if (setRows.length === 0) return null;
    const set = setRows[0]!;
    const activeAt = options.activeAt ?? clockNow();

    // Members visible to this tenant: platform (tenant_id IS NULL)
    // plus this tenant's own extensions
    const members = await withTenantContext(this.db, tenantId, async (tx) =>
      tx
        .select()
        .from(valueSetMembers)
        .where(
          and(
            eq(valueSetMembers.valueSetId, set.id),
            // Active at the requested point in time
            lte(valueSetMembers.activeFrom, activeAt),
            or(isNull(valueSetMembers.activeTo), gt(valueSetMembers.activeTo, activeAt)),
            // Tenant visibility (mirrors RLS policy)
            or(
              isNull(valueSetMembers.tenantId),
              eq(valueSetMembers.tenantId, tenantId),
            ),
          ),
        )
        .orderBy(valueSetMembers.sortOrder, valueSetMembers.code),
    );

    const dto: ValueSetDto = {
      setCode:       set.setCode,
      displayName:   set.displayName,
      source:        set.source,
      sourceVersion: set.sourceVersion ?? null,
      description:   set.description ?? null,
      isExtensible:  set.isExtensible,
      members: members.map((m) => ({
        code:           m.code,
        displayLabel:   m.displayLabel,
        description:    m.description ?? null,
        sortOrder:      m.sortOrder ?? 0,
        activeFrom:     m.activeFrom.toISOString(),
        activeTo:       m.activeTo?.toISOString() ?? null,
        sourceMetadata: m.sourceMetadata as Record<string, unknown> | null ?? null,
      })),
    };

    this.cache.set(cacheKey, { data: dto, expiresAt: Date.now() + this.ttlMs });  // clock:allow
    return dto;
  }

  /**
   * Look up the value set code for a specific data-model field.
   * Returns null if the field has no registered value set.
   */
  async getValueSetForField(
    entityName: string,
    fieldName:  string,
  ): Promise<string | null> {
    const rows = await this.db
      .select({ valueSetCode: fieldValueSets.valueSetCode })
      .from(fieldValueSets)
      .where(
        and(
          eq(fieldValueSets.entityName, entityName),
          eq(fieldValueSets.fieldName, fieldName),
        ),
      )
      .limit(1);

    return rows[0]?.valueSetCode ?? null;
  }

  /**
   * Validate a code value against its registered value set for a field.
   * Returns true if the code is active and known for the field.
   * Returns null if no value set is registered for the field (non-constraining).
   */
  async validateFieldValue(
    entityName: string,
    fieldName:  string,
    value:      string,
    tenantId:   string,
    asAt?:      Date,
  ): Promise<boolean | null> {
    const setCode = await this.getValueSetForField(entityName, fieldName);
    if (!setCode) return null;

    const valueSet = await this.getValueSet(
      setCode,
      tenantId,
      asAt ? { activeAt: asAt } : {},
    );
    if (!valueSet) return false;

    return valueSet.members.some((m) => m.code === value);
  }

  /**
   * Add a tenant-specific extension value to an extensible value set.
   * Throws if the set is not extensible or the code already exists.
   */
  async addTenantValue(
    setCode:  string,
    tenantId: string,
    input: {
      code:         string;
      displayLabel: string;
      description?: string;
      sortOrder?:   number;
    },
  ): Promise<ValueSetMemberDto> {
    const setRows = await this.db
      .select()
      .from(valueSets)
      .where(and(eq(valueSets.setCode, setCode), eq(valueSets.isExtensible, true)))
      .limit(1);

    if (setRows.length === 0) {
      throw new Error(`Value set '${setCode}' does not exist or is not extensible`);
    }

    const set = setRows[0]!;
    const now  = clockNow();

    await withTenantContext(this.db, tenantId, async (tx) => {
      await tx.insert(valueSetMembers).values({
        valueSetId:   set.id,
        tenantId,
        code:         input.code,
        displayLabel: input.displayLabel,
        description:  input.description ?? null,
        sortOrder:    input.sortOrder ?? 0,
        activeFrom:   now,
      });
    });

    // Invalidate any cached result for this set + tenant
    for (const key of this.cache.keys()) {
      if (key.startsWith(`${setCode}:${tenantId}:`)) this.cache.delete(key);
    }

    return {
      code:           input.code,
      displayLabel:   input.displayLabel,
      description:    input.description ?? null,
      sortOrder:      input.sortOrder ?? 0,
      activeFrom:     now.toISOString(),
      activeTo:       null,
      sourceMetadata: null,
    };
  }

  invalidateTenant(tenantId: string): void {
    for (const key of this.cache.keys()) {
      if (key.includes(`:${tenantId}:`)) this.cache.delete(key);
    }
  }
}
