import { and, eq, gt, inArray, isNull, lte, or } from 'drizzle-orm';
import {
  fieldValueSets,
  valueSetMemberOverrides,
  valueSetMembers,
  valueSets,
  withTenantContext,
  type Db,
  type ValueSetMember,
} from '@revelation-srs/db';
import { NotFoundError, ValidationError } from '@revelation-srs/domain';

import { clockNow } from '../clock.js';

export interface ValueSetMemberDto {
  code:          string;
  displayLabel:  string;
  description:   string | null;
  sortOrder:     number;
  activeFrom:    string | null; // null = valid from beginning of time
  activeTo:      string | null; // null = valid forever
  sourceMetadata: Record<string, unknown> | null;
  /** Within its active window at the time asked about. */
  active:        boolean;
  /** This institution has taken it out of its pickers. */
  hidden:        boolean;
  /** Offered for new entries: active and not hidden. */
  selectable:    boolean;
}

/**
 * Which members a lookup returns:
 *   selectable — what a picker offers (active, not hidden); the default
 *   active     — what validates (active, hidden or not)
 *   all        — every member, retired and scheduled ones too, to label old records
 */
export type MemberInclusion = 'selectable' | 'active' | 'all';

export interface ManagedMemberDto extends ValueSetMemberDto {
  isTenantOwned:       boolean;
  /** The platform's own wording, shown beside an institution's relabel. */
  platformLabel:       string;
  platformDescription: string | null;
  overridden:          boolean;
  overrideUpdatedBy:   string | null;
  overrideUpdatedAt:   string | null;
}

export interface OverrideInput {
  /** null: back to the platform label. */
  displayLabel?: string | null;
  description?:  string | null;
  hidden?:       boolean;
}

export interface ValueSetDto {
  setCode:       string;
  displayName:   string;
  source:        string;
  sourceVersion: string | null;
  description:   string | null;
  isExtensible:  boolean;
  allowsTenantHide: boolean;
  members:       ValueSetMemberDto[];
}

export interface ValueSetSummaryDto extends Omit<ValueSetDto, 'members'> {
  /** The data-model fields this set governs. */
  usedBy: Array<{ entityName: string; fieldName: string }>;
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
type Uuid = `${string}-${string}-${string}-${string}-${string}`;

function memberToDto(
  m: ValueSetMember,
  override: { displayLabel: string | null; description: string | null; hidden: boolean } | undefined,
  at: Date,
): ValueSetMemberDto {
  const active = (!m.activeFrom || m.activeFrom <= at) && (!m.activeTo || m.activeTo > at);
  const hidden = override?.hidden ?? false;
  return {
    code:           m.code,
    displayLabel:   override?.displayLabel ?? m.displayLabel,
    description:    override?.description ?? m.description ?? null,
    sortOrder:      m.sortOrder ?? 0,
    activeFrom:     m.activeFrom?.toISOString() ?? null,
    activeTo:       m.activeTo?.toISOString() ?? null,
    sourceMetadata: m.sourceMetadata as Record<string, unknown> | null ?? null,
    active,
    hidden,
    selectable:     active && !hidden,
  };
}

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
  async listValueSets(): Promise<ValueSetSummaryDto[]> {
    const [rows, fields] = await Promise.all([
      this.db.select().from(valueSets).orderBy(valueSets.displayName),
      this.db.select().from(fieldValueSets).orderBy(fieldValueSets.entityName, fieldValueSets.fieldName),
    ]);
    const usedBy = new Map<string, Array<{ entityName: string; fieldName: string }>>();
    for (const f of fields) {
      usedBy.set(f.valueSetCode, [...(usedBy.get(f.valueSetCode) ?? []), { entityName: f.entityName, fieldName: f.fieldName }]);
    }
    return rows.map((r) => ({
      setCode:       r.setCode,
      displayName:   r.displayName,
      source:        r.source,
      sourceVersion: r.sourceVersion ?? null,
      description:   r.description ?? null,
      isExtensible:  r.isExtensible,
      allowsTenantHide: r.allowsTenantHide,
      usedBy:        usedBy.get(r.setCode) ?? [],
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
    options:  { activeAt?: Date; force?: boolean; include?: MemberInclusion } = {},
  ): Promise<ValueSetDto | null> {
    const include = options.include ?? 'selectable';
    const activeAtKey = options.activeAt?.toISOString() ?? 'now';
    const cacheKey = `${setCode}:${tenantId}:${activeAtKey}:${include}`;

    if (!options.force) {
      const cached = this.cache.get(cacheKey);
      if (cached && cached.expiresAt > Date.now()) return cached.data;  // clock:allow
    }

    const set = await this.#set(setCode);
    if (!set) return null;
    const activeAt = options.activeAt ?? clockNow();

    // Members visible to this tenant: platform (tenant_id IS NULL)
    // plus this tenant's own extensions; 'all' keeps retired and scheduled ones.
    const { members, overrides } = await withTenantContext(this.db, tenantId, async (tx) => {
      const rows = await tx
        .select()
        .from(valueSetMembers)
        .where(
          and(
            eq(valueSetMembers.valueSetId, set.id),
            ...(include === 'all' ? [] : [
              // NULL activeFrom = valid from beginning of time; NULL activeTo = valid forever.
              or(isNull(valueSetMembers.activeFrom), lte(valueSetMembers.activeFrom, activeAt)),
              or(isNull(valueSetMembers.activeTo),   gt(valueSetMembers.activeTo, activeAt)),
            ]),
            // Tenant visibility (mirrors RLS policy)
            or(
              isNull(valueSetMembers.tenantId),
              eq(valueSetMembers.tenantId, tenantId),
            ),
          ),
        )
        .orderBy(valueSetMembers.sortOrder, valueSetMembers.code);
      return { members: rows, overrides: await this.#overrides(tx, tenantId, rows) };
    });

    const dtos = members
      .map((m) => memberToDto(m, overrides.get(m.id), activeAt))
      .filter((m) => include !== 'selectable' || m.selectable);

    const dto: ValueSetDto = {
      setCode:       set.setCode,
      displayName:   set.displayName,
      source:        set.source,
      sourceVersion: set.sourceVersion ?? null,
      description:   set.description ?? null,
      isExtensible:  set.isExtensible,
      allowsTenantHide: set.allowsTenantHide,
      members:       dtos,
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

    // A value the institution has hidden still validates: hiding only
    // takes it out of pickers, and the system may still write it.
    const valueSet = await this.getValueSet(
      setCode,
      tenantId,
      { include: 'active', ...(asAt ? { activeAt: asAt } : {}) },
    );
    if (!valueSet) return false;

    return valueSet.members.some((m) => m.code === value);
  }

  /**
   * List ALL members for a value set visible to a tenant — including inactive
   * and future-scheduled ones. Used by the tenant-admin management UI.
   *
   * Platform members (tenantId IS NULL) are returned with isTenantOwned=false;
   * these can be viewed but not edited via the management API.
   */
  async listAllMembers(
    setCode:  string,
    tenantId: string,
  ): Promise<ManagedMemberDto[]> {
    const set = await this.#set(setCode);
    if (!set) return [];
    const now = clockNow();

    const { members, overrides } = await withTenantContext(this.db, tenantId, async (tx) => {
      const rows = await tx
        .select()
        .from(valueSetMembers)
        .where(
          and(
            eq(valueSetMembers.valueSetId, set.id),
            or(
              isNull(valueSetMembers.tenantId),
              eq(valueSetMembers.tenantId, tenantId),
            ),
          ),
        )
        .orderBy(valueSetMembers.sortOrder, valueSetMembers.code);
      return { members: rows, overrides: await this.#overrides(tx, tenantId, rows) };
    });

    return members.map((m) => {
      const o = overrides.get(m.id);
      return {
        ...memberToDto(m, o, now),
        isTenantOwned:       m.tenantId !== null,
        platformLabel:       m.displayLabel,
        platformDescription: m.description ?? null,
        overridden:          o !== undefined,
        overrideUpdatedBy:   o?.updatedBy ?? null,
        overrideUpdatedAt:   o?.updatedAt.toISOString() ?? null,
      };
    });
  }

  /**
   * Relabel or hide a platform value for one institution. Clearing every
   * part of an override (no label, no description, not hidden) removes it.
   * The institution's own values are edited directly, not overridden.
   */
  async setOverride(
    setCode:    string,
    tenantId:   string,
    memberCode: string,
    input:      OverrideInput,
    actorId:    string,
  ): Promise<ManagedMemberDto> {
    const set = await this.#set(setCode);
    if (!set) throw new NotFoundError('ValueSet', setCode);
    const [member] = await this.db.select().from(valueSetMembers)
      .where(and(eq(valueSetMembers.valueSetId, set.id), eq(valueSetMembers.code, memberCode), isNull(valueSetMembers.tenantId)))
      .limit(1);
    if (!member) throw new NotFoundError('ValueSetMember', `${setCode}/${memberCode}`);
    if (input.hidden === true && !set.allowsTenantHide) {
      throw new ValidationError(
        `'${set.displayName}' values are written by the system, so they can be relabelled but not hidden`,
        [{ field: 'hidden', message: 'This value set does not allow hiding' }],
      );
    }
    const label = input.displayLabel === undefined ? undefined : (input.displayLabel?.trim() || null);
    const description = input.description === undefined ? undefined : (input.description?.trim() || null);

    await withTenantContext(this.db, tenantId, async (tx) => {
      const [existing] = await tx.select().from(valueSetMemberOverrides)
        .where(and(eq(valueSetMemberOverrides.tenantId, tenantId as Uuid), eq(valueSetMemberOverrides.valueSetMemberId, member.id)))
        .limit(1);
      const next = {
        displayLabel: label === undefined ? (existing?.displayLabel ?? null) : label,
        description:  description === undefined ? (existing?.description ?? null) : description,
        hidden:       input.hidden ?? existing?.hidden ?? false,
      };
      if (next.displayLabel === null && next.description === null && !next.hidden) {
        if (existing) await tx.delete(valueSetMemberOverrides).where(eq(valueSetMemberOverrides.id, existing.id));
        return;
      }
      if (existing) {
        await tx.update(valueSetMemberOverrides).set({ ...next, updatedBy: actorId, updatedAt: clockNow() })
          .where(eq(valueSetMemberOverrides.id, existing.id));
      } else {
        await tx.insert(valueSetMemberOverrides).values({
          tenantId: tenantId as Uuid, valueSetMemberId: member.id, ...next, updatedBy: actorId, updatedAt: clockNow(),
        });
      }
    });

    this.#invalidate(setCode, tenantId);
    const managed = (await this.listAllMembers(setCode, tenantId)).find((m) => m.code === memberCode && !m.isTenantOwned);
    return managed!;
  }

  /** Back to the platform's wording, shown again in pickers. */
  async clearOverride(setCode: string, tenantId: string, memberCode: string, actorId: string): Promise<ManagedMemberDto> {
    return this.setOverride(setCode, tenantId, memberCode, { displayLabel: null, description: null, hidden: false }, actorId);
  }

  async #set(setCode: string) {
    const [row] = await this.db.select().from(valueSets).where(eq(valueSets.setCode, setCode)).limit(1);
    return row ?? null;
  }

  async #overrides(tx: Parameters<Parameters<typeof withTenantContext>[2]>[0], tenantId: string, members: ValueSetMember[]) {
    const platformIds = members.filter((m) => m.tenantId === null).map((m) => m.id);
    if (platformIds.length === 0) return new Map<string, typeof valueSetMemberOverrides.$inferSelect>();
    const rows = await tx.select().from(valueSetMemberOverrides)
      .where(and(eq(valueSetMemberOverrides.tenantId, tenantId as Uuid), inArray(valueSetMemberOverrides.valueSetMemberId, platformIds)));
    return new Map(rows.map((r) => [r.valueSetMemberId, r]));
  }

  #invalidate(setCode: string, tenantId: string): void {
    for (const key of this.cache.keys()) {
      if (key.startsWith(`${setCode}:${tenantId}:`)) this.cache.delete(key);
    }
  }

  /**
   * Update a tenant-owned value set member (label, description, sort order,
   * or the active window). Returns 'not-found' if the member does not exist
   * or belongs to the platform (and is therefore read-only for this tenant).
   */
  async updateTenantValue(
    setCode:    string,
    tenantId:   string,
    memberCode: string,
    patch: {
      displayLabel?: string;
      description?:  string | null;
      sortOrder?:    number;
      activeFrom?:   string | null;
      activeTo?:     string | null;
    },
  ): Promise<'updated' | 'not-found'> {
    const setRows = await this.db
      .select()
      .from(valueSets)
      .where(eq(valueSets.setCode, setCode))
      .limit(1);

    if (setRows.length === 0) return 'not-found';
    const set = setRows[0]!;

    const updates: Record<string, unknown> = {};
    if (patch.displayLabel !== undefined) updates['displayLabel'] = patch.displayLabel;
    if (patch.description  !== undefined) updates['description']  = patch.description;
    if (patch.sortOrder    !== undefined) updates['sortOrder']    = patch.sortOrder;
    if ('activeFrom' in patch)            updates['activeFrom']   = patch.activeFrom ? new Date(patch.activeFrom) : null;
    if ('activeTo'   in patch)            updates['activeTo']     = patch.activeTo   ? new Date(patch.activeTo)   : null;

    const result = await withTenantContext(this.db, tenantId, async (tx) =>
      tx
        .update(valueSetMembers)
        .set(updates)
        .where(
          and(
            eq(valueSetMembers.valueSetId, set.id),
            eq(valueSetMembers.code,       memberCode),
            eq(valueSetMembers.tenantId,   tenantId),
          ),
        )
        .returning({ id: valueSetMembers.id }),
    );

    if (result.length === 0) return 'not-found';

    for (const key of this.cache.keys()) {
      if (key.startsWith(`${setCode}:${tenantId}:`)) this.cache.delete(key);
    }
    return 'updated';
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
      activeFrom?:  string | null;
      activeTo?:    string | null;
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

    await withTenantContext(this.db, tenantId, async (tx) => {
      await tx.insert(valueSetMembers).values({
        valueSetId:   set.id,
        tenantId,
        code:         input.code,
        displayLabel: input.displayLabel,
        description:  input.description ?? null,
        sortOrder:    input.sortOrder ?? 0,
        activeFrom:   input.activeFrom ? new Date(input.activeFrom) : null,
        activeTo:     input.activeTo   ? new Date(input.activeTo)   : null,
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
      activeFrom:     input.activeFrom ?? null,
      activeTo:       input.activeTo   ?? null,
      sourceMetadata: null,
      ...(() => {
        const now = clockNow();
        const active = (!input.activeFrom || new Date(input.activeFrom) <= now) && (!input.activeTo || new Date(input.activeTo) > now);
        return { active, hidden: false, selectable: active };
      })(),
    };
  }

  invalidateTenant(tenantId: string): void {
    for (const key of this.cache.keys()) {
      if (key.includes(`:${tenantId}:`)) this.cache.delete(key);
    }
  }
}
