import { and, eq, gt, inArray, isNull, lte, or } from 'drizzle-orm';
import {
  fieldValueSets,
  localeResourcePacks,
  valueSetMemberLabels,
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

/** One wording that replaces a value's own label. */
export interface WordingDto {
  /** 'tenant': this institution's; 'platform': every institution's. */
  scope:        'tenant' | 'platform';
  /** null: any language. */
  localeCode:   string | null;
  displayLabel: string | null;
  description:  string | null;
  updatedBy:    string | null;
  updatedAt:    string;
}

export interface ManagedMemberDto extends ValueSetMemberDto {
  isTenantOwned:       boolean;
  /** The value's own wording, beside an institution's relabel. */
  platformLabel:       string;
  platformDescription: string | null;
  /** This institution has reworded (in any language) or hidden it. */
  overridden:          boolean;
  /** Every wording for the value this institution can see. */
  wordings:            WordingDto[];
}

export interface WordingInput {
  /** null or omitted: any language. */
  localeCode?:   string | null;
  /** null: no reworded label (the next match applies). */
  displayLabel?: string | null;
  description?:  string | null;
  /** 'platform' writes every institution's wording (a translation); needs a locale. */
  scope?:        'tenant' | 'platform';
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

type Uuid = `${string}-${string}-${string}-${string}-${string}`;
type Tx = Parameters<Parameters<typeof withTenantContext>[2]>[0];
type LabelRow = typeof valueSetMemberLabels.$inferSelect;

/**
 * The wording a reader sees, most specific first: this institution in the
 * reader's language, this institution in any language, the platform in the
 * reader's language. Label and description resolve separately, so a row
 * may reword only one. Undefined: the value's own wording applies.
 */
function resolveWording(rows: LabelRow[], tenantId: string, locale: string | undefined) {
  const order = (r: LabelRow) =>
    r.tenantId === tenantId && locale !== undefined && r.localeCode === locale ? 0
      : r.tenantId === tenantId && r.localeCode === null ? 1
      : r.tenantId === null && locale !== undefined && r.localeCode === locale ? 2
      : -1;
  const ranked = rows.map((r) => ({ r, rank: order(r) })).filter((x) => x.rank >= 0).sort((a, b) => a.rank - b.rank);
  if (ranked.length === 0) return undefined;
  return {
    displayLabel: ranked.find((x) => x.r.displayLabel !== null)?.r.displayLabel ?? null,
    description:  ranked.find((x) => x.r.description !== null)?.r.description ?? null,
  };
}

function memberToDto(
  m: ValueSetMember,
  wording: { displayLabel: string | null; description: string | null } | undefined,
  hidden: boolean,
  at: Date,
): ValueSetMemberDto {
  const active = (!m.activeFrom || m.activeFrom <= at) && (!m.activeTo || m.activeTo > at);
  return {
    code:           m.code,
    displayLabel:   wording?.displayLabel ?? m.displayLabel,
    description:    wording?.description ?? m.description ?? null,
    sortOrder:      m.sortOrder ?? 0,
    activeFrom:     m.activeFrom?.toISOString() ?? null,
    activeTo:       m.activeTo?.toISOString() ?? null,
    sourceMetadata: m.sourceMetadata as Record<string, unknown> | null ?? null,
    active,
    hidden,
    selectable:     active && !hidden,
  };
}

/**
 * Provides access to valid value sets for UI dropdowns, API validation,
 * and HESA/regulatory coding lookups.
 *
 * Value sets combine platform-managed codes (statutory HESA, SLC, UCAS)
 * with tenant-specific extensions where the set is marked extensible. Every
 * lookup applies the institution's hidden values and the wording for the
 * reader's language (value_set_member_label).
 *
 * Results are cached in memory per tenant and language with a TTL
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

  /** Every value set (without members), with the fields each one governs. */
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
   * A value set with its members for a tenant, in the reader's language
   * (`locale`, e.g. 'cy-GB'; omitted: the institution's own wording).
   * activeAt defaults to now — pass a past date for historical reconstruction.
   */
  async getValueSet(
    setCode:  string,
    tenantId: string,
    options:  { activeAt?: Date; force?: boolean; include?: MemberInclusion; locale?: string } = {},
  ): Promise<ValueSetDto | null> {
    const include = options.include ?? 'selectable';
    const activeAtKey = options.activeAt?.toISOString() ?? 'now';
    const cacheKey = `${setCode}:${tenantId}:${activeAtKey}:${include}:${options.locale ?? ''}`;

    if (!options.force) {
      const cached = this.cache.get(cacheKey);
      if (cached && cached.expiresAt > Date.now()) return cached.data;  // clock:allow
    }

    const set = await this.#set(setCode);
    if (!set) return null;
    const activeAt = options.activeAt ?? clockNow();

    const { members, labels, hidden } = await withTenantContext(this.db, tenantId, async (tx) => {
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
            or(isNull(valueSetMembers.tenantId), eq(valueSetMembers.tenantId, tenantId)),
          ),
        )
        .orderBy(valueSetMembers.sortOrder, valueSetMembers.code);
      return { members: rows, labels: await this.#labels(tx, tenantId, rows), hidden: await this.#hidden(tx, tenantId, rows) };
    });

    const dtos = members
      .map((m) => memberToDto(m, resolveWording(labels.get(m.id) ?? [], tenantId, options.locale), hidden.has(m.id), activeAt))
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
      .where(and(eq(fieldValueSets.entityName, entityName), eq(fieldValueSets.fieldName, fieldName)))
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
    const valueSet = await this.getValueSet(setCode, tenantId, { include: 'active', ...(asAt ? { activeAt: asAt } : {}) });
    if (!valueSet) return false;

    return valueSet.members.some((m) => m.code === value);
  }

  /**
   * Every member visible to a tenant — retired and scheduled ones too — with
   * every wording it can see, for the management screen. Platform members are
   * isTenantOwned=false: reworded and hidden, never edited directly.
   */
  async listAllMembers(setCode: string, tenantId: string): Promise<ManagedMemberDto[]> {
    const set = await this.#set(setCode);
    if (!set) return [];
    const now = clockNow();

    const { members, labels, hidden } = await withTenantContext(this.db, tenantId, async (tx) => {
      const rows = await tx
        .select()
        .from(valueSetMembers)
        .where(and(eq(valueSetMembers.valueSetId, set.id), or(isNull(valueSetMembers.tenantId), eq(valueSetMembers.tenantId, tenantId))))
        .orderBy(valueSetMembers.sortOrder, valueSetMembers.code);
      return { members: rows, labels: await this.#labels(tx, tenantId, rows), hidden: await this.#hidden(tx, tenantId, rows) };
    });

    return members.map((m) => {
      const rows = labels.get(m.id) ?? [];
      const own = rows.filter((r) => r.tenantId === tenantId);
      return {
        ...memberToDto(m, resolveWording(rows, tenantId, undefined), hidden.has(m.id), now),
        isTenantOwned:       m.tenantId !== null,
        platformLabel:       m.displayLabel,
        platformDescription: m.description ?? null,
        overridden:          hidden.has(m.id) || own.some((r) => r.localeCode === null),
        wordings:            rows
          .sort((a, b) => (a.tenantId === null ? 1 : 0) - (b.tenantId === null ? 1 : 0) || (a.localeCode ?? '').localeCompare(b.localeCode ?? ''))
          .map((r) => ({
            scope:        r.tenantId === null ? 'platform' as const : 'tenant' as const,
            localeCode:   r.localeCode,
            displayLabel: r.displayLabel,
            description:  r.description,
            updatedBy:    r.updatedBy,
            updatedAt:    r.updatedAt.toISOString(),
          })),
      };
    });
  }

  /**
   * Set (or, with no label and no description, remove) one wording for a
   * value: this institution's, in a language or any; or, with scope
   * 'platform', every institution's in a language. An institution's own
   * values are reworded for any language by editing the value itself.
   */
  async setWording(
    setCode:    string,
    tenantId:   string,
    memberCode: string,
    input:      WordingInput,
    actorId:    string,
  ): Promise<ManagedMemberDto> {
    const scope = input.scope ?? 'tenant';
    const localeCode = input.localeCode ?? null;
    const member = await this.#member(setCode, tenantId, memberCode);
    if (scope === 'platform') {
      if (member.tenantId !== null) throw new ValidationError('Only platform values have platform-wide wording', [{ field: 'scope', message: 'Use this institution\'s wording' }]);
      if (!localeCode) throw new ValidationError('Platform-wide wording is a translation: give a language', [{ field: 'localeCode', message: 'Required for platform wording' }]);
    }
    if (scope === 'tenant' && member.tenantId !== null && localeCode === null) {
      throw new ValidationError('Edit your institution\'s own value to change its wording in every language', [{ field: 'localeCode', message: 'Give a language, or edit the value' }]);
    }
    if (localeCode) await this.#assertLocale(localeCode);

    const label = input.displayLabel?.trim() || null;
    const description = input.description?.trim() || null;
    const owner = scope === 'platform' ? null : tenantId;

    await withTenantContext(this.db, tenantId, async (tx) => {
      const [existing] = await tx.select().from(valueSetMemberLabels).where(and(
        eq(valueSetMemberLabels.valueSetMemberId, member.id),
        owner === null ? isNull(valueSetMemberLabels.tenantId) : eq(valueSetMemberLabels.tenantId, owner as Uuid),
        localeCode === null ? isNull(valueSetMemberLabels.localeCode) : eq(valueSetMemberLabels.localeCode, localeCode),
      )).limit(1);
      if (label === null && description === null) {
        if (existing) await tx.delete(valueSetMemberLabels).where(eq(valueSetMemberLabels.id, existing.id));
        return;
      }
      const values = { displayLabel: label, description, updatedBy: actorId, updatedAt: clockNow() };
      if (existing) {
        await tx.update(valueSetMemberLabels).set(values).where(eq(valueSetMemberLabels.id, existing.id));
      } else {
        await tx.insert(valueSetMemberLabels).values({ tenantId: owner as Uuid | null, valueSetMemberId: member.id, localeCode, ...values });
      }
    });

    if (scope === 'platform') this.cache.clear(); else this.#invalidate(setCode, tenantId);
    return this.#managed(setCode, tenantId, memberCode);
  }

  /** Take a platform value out of this institution's pickers, or put it back. */
  async setHidden(setCode: string, tenantId: string, memberCode: string, hidden: boolean, actorId: string): Promise<ManagedMemberDto> {
    const set = await this.#set(setCode);
    if (!set) throw new NotFoundError('ValueSet', setCode);
    const member = await this.#member(setCode, tenantId, memberCode);
    if (member.tenantId !== null) throw new ValidationError('Retire your institution\'s own values instead of hiding them', [{ field: 'hidden', message: 'Retire the value instead' }]);
    if (hidden && !set.allowsTenantHide) {
      throw new ValidationError(
        `'${set.displayName}' values are written by the system, so they can be relabelled but not hidden`,
        [{ field: 'hidden', message: 'This value set does not allow hiding' }],
      );
    }
    await withTenantContext(this.db, tenantId, async (tx) => {
      const where = and(eq(valueSetMemberOverrides.tenantId, tenantId as Uuid), eq(valueSetMemberOverrides.valueSetMemberId, member.id));
      if (!hidden) {
        await tx.delete(valueSetMemberOverrides).where(where);
        return;
      }
      const [existing] = await tx.select().from(valueSetMemberOverrides).where(where).limit(1);
      if (existing) await tx.update(valueSetMemberOverrides).set({ hidden: true, updatedBy: actorId, updatedAt: clockNow() }).where(eq(valueSetMemberOverrides.id, existing.id));
      else await tx.insert(valueSetMemberOverrides).values({ tenantId: tenantId as Uuid, valueSetMemberId: member.id, hidden: true, updatedBy: actorId, updatedAt: clockNow() });
    });
    this.#invalidate(setCode, tenantId);
    return this.#managed(setCode, tenantId, memberCode);
  }

  /** Back to the platform's wording in every language, and shown in pickers again. */
  async clearCustomisation(setCode: string, tenantId: string, memberCode: string): Promise<ManagedMemberDto> {
    const member = await this.#member(setCode, tenantId, memberCode);
    await withTenantContext(this.db, tenantId, async (tx) => {
      await tx.delete(valueSetMemberLabels).where(and(eq(valueSetMemberLabels.valueSetMemberId, member.id), eq(valueSetMemberLabels.tenantId, tenantId as Uuid)));
      await tx.delete(valueSetMemberOverrides).where(and(eq(valueSetMemberOverrides.valueSetMemberId, member.id), eq(valueSetMemberOverrides.tenantId, tenantId as Uuid)));
    });
    this.#invalidate(setCode, tenantId);
    return this.#managed(setCode, tenantId, memberCode);
  }

  async #managed(setCode: string, tenantId: string, memberCode: string): Promise<ManagedMemberDto> {
    const m = (await this.listAllMembers(setCode, tenantId)).find((x) => x.code === memberCode);
    if (!m) throw new NotFoundError('ValueSetMember', `${setCode}/${memberCode}`);
    return m;
  }

  async #set(setCode: string) {
    const [row] = await this.db.select().from(valueSets).where(eq(valueSets.setCode, setCode)).limit(1);
    return row ?? null;
  }

  /** A member this tenant can see: platform, or its own. */
  async #member(setCode: string, tenantId: string, memberCode: string): Promise<ValueSetMember> {
    const set = await this.#set(setCode);
    if (!set) throw new NotFoundError('ValueSet', setCode);
    const [member] = await withTenantContext(this.db, tenantId, (tx) => tx.select().from(valueSetMembers)
      .where(and(eq(valueSetMembers.valueSetId, set.id), eq(valueSetMembers.code, memberCode),
        or(isNull(valueSetMembers.tenantId), eq(valueSetMembers.tenantId, tenantId))))
      .orderBy(valueSetMembers.tenantId)
      .limit(1));
    if (!member) throw new NotFoundError('ValueSetMember', `${setCode}/${memberCode}`);
    return member;
  }

  async #assertLocale(localeCode: string): Promise<void> {
    const [row] = await this.db.select({ code: localeResourcePacks.localeCode }).from(localeResourcePacks)
      .where(and(eq(localeResourcePacks.localeCode, localeCode), eq(localeResourcePacks.active, true))).limit(1);
    if (!row) throw new ValidationError(`'${localeCode}' is not an active language`, [{ field: 'localeCode', message: 'Must be an active locale' }]);
  }

  /** Wording rows for these members that this tenant can see: its own and the platform's. */
  async #labels(tx: Tx, tenantId: string, members: ValueSetMember[]): Promise<Map<string, LabelRow[]>> {
    if (members.length === 0) return new Map();
    const rows = await tx.select().from(valueSetMemberLabels).where(and(
      inArray(valueSetMemberLabels.valueSetMemberId, members.map((m) => m.id)),
      or(isNull(valueSetMemberLabels.tenantId), eq(valueSetMemberLabels.tenantId, tenantId as Uuid)),
    ));
    const out = new Map<string, LabelRow[]>();
    for (const r of rows) out.set(r.valueSetMemberId, [...(out.get(r.valueSetMemberId) ?? []), r]);
    return out;
  }

  /** Platform members this tenant has hidden. */
  async #hidden(tx: Tx, tenantId: string, members: ValueSetMember[]): Promise<Set<string>> {
    const platformIds = members.filter((m) => m.tenantId === null).map((m) => m.id);
    if (platformIds.length === 0) return new Set();
    const rows = await tx.select({ id: valueSetMemberOverrides.valueSetMemberId }).from(valueSetMemberOverrides)
      .where(and(eq(valueSetMemberOverrides.tenantId, tenantId as Uuid), inArray(valueSetMemberOverrides.valueSetMemberId, platformIds), eq(valueSetMemberOverrides.hidden, true)));
    return new Set(rows.map((r) => r.id));
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
