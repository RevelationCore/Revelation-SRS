import { randomUUID } from 'node:crypto';

import { and, eq, inArray } from 'drizzle-orm';
import {
  localeResourcePacks,
  tenantLocaleConfigs,
  valueSetMemberLabels,
  valueSetMembers,
  valueSets,
  type Db,
  withTenantContext,
} from '@revelation-srs/db';
import { NotFoundError, ValidationError } from '@revelation-srs/domain';

import type { AuditService } from '../audit/service.js';
import { clockNow } from '../clock.js';

// ── DTOs ─────────────────────────────────────────────────────────────────────

export interface LocaleResourcePackDto {
  localeCode:        string;
  displayName:       string;
  nativeDisplayName: string;
  isRtl:             boolean;
  isPlatformDefault: boolean;
  active:            boolean;
}

export interface TenantLocaleConfigDto {
  tenantLocaleConfigId: string;
  tenantId:             string;
  defaultLocale:        string;
  fallbackLocale:       string;
  supportedLocales:     string[];
  defaultTimeZone:      string;
  dateFormatCode:       string;
  firstDayOfWeek:       number;
  updatedAt:            Date;
}

export interface UpsertTenantLocaleConfigInput {
  defaultLocale?:    string;
  fallbackLocale?:   string;
  supportedLocales?: string[];
  defaultTimeZone?:  string;
  dateFormatCode?:   string;
  firstDayOfWeek?:   number;
}

export interface ValueSetMemberLabelDto {
  valueSetMemberLabelId: string;
  valueSetMemberId:      string;
  localeCode:            string;
  displayLabel:          string;
  description:           string | null;
  createdAt:             Date;
}

export interface AddValueSetMemberLabelInput {
  valueSetMemberId: string;
  localeCode:       string;
  displayLabel:     string;
  description?:     string;
}

export interface ResolvedLabel {
  code:         string;
  displayLabel: string;
  locale:       string;
  isFallback:   boolean;
}

// ── Service ───────────────────────────────────────────────────────────────────

export class LocaleService {
  constructor(
    private readonly db: Db,
    private readonly audit: AuditService,
  ) {}

  async listLocaleResourcePacks(activeOnly = true): Promise<LocaleResourcePackDto[]> {
    const rows = await this.db
      .select()
      .from(localeResourcePacks)
      .orderBy(localeResourcePacks.displayName);

    return rows
      .filter((r) => !activeOnly || r.active)
      .map(toLocalePackDto);
  }

  async getLocaleResourcePack(localeCode: string): Promise<LocaleResourcePackDto> {
    const rows = await this.db
      .select()
      .from(localeResourcePacks)
      .where(eq(localeResourcePacks.localeCode, localeCode));

    if (!rows[0]) throw new NotFoundError('LocaleResourcePack', localeCode);
    return toLocalePackDto(rows[0]);
  }

  async getTenantLocaleConfig(tenantId: string): Promise<TenantLocaleConfigDto> {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx.select().from(tenantLocaleConfigs).where(eq(tenantLocaleConfigs.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`)),
    );

    if (rows[0]) return toLocaleConfigDto(rows[0]);

    // Auto-provision default config for the tenant
    return this.upsertTenantLocaleConfig(tenantId, {}, 'system');
  }

  async upsertTenantLocaleConfig(
    tenantId: string,
    input: UpsertTenantLocaleConfigInput,
    actorId: string,
  ): Promise<TenantLocaleConfigDto> {
    if (input.defaultLocale !== undefined) {
      await this.#assertLocaleExists(input.defaultLocale);
    }
    if (input.fallbackLocale !== undefined) {
      await this.#assertLocaleExists(input.fallbackLocale);
    }
    if (input.supportedLocales !== undefined) {
      for (const lc of input.supportedLocales) {
        await this.#assertLocaleExists(lc);
      }
    }
    if (input.firstDayOfWeek !== undefined && (input.firstDayOfWeek < 1 || input.firstDayOfWeek > 7)) {
      throw new ValidationError('firstDayOfWeek must be between 1 (Monday) and 7 (Sunday)');
    }

    const now = clockNow();
    const existing = await withTenantContext(this.db, tenantId, async (tx) =>
      tx.select({ id: tenantLocaleConfigs.id }).from(tenantLocaleConfigs)
        .where(eq(tenantLocaleConfigs.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`)),
    );

    let result: typeof tenantLocaleConfigs.$inferSelect;

    if (existing[0]) {
      const updated = await withTenantContext(this.db, tenantId, async (tx) =>
        tx.update(tenantLocaleConfigs)
          .set({
            ...(input.defaultLocale    !== undefined ? { defaultLocale:    input.defaultLocale }    : {}),
            ...(input.fallbackLocale   !== undefined ? { fallbackLocale:   input.fallbackLocale }   : {}),
            ...(input.supportedLocales !== undefined ? { supportedLocales: input.supportedLocales } : {}),
            ...(input.defaultTimeZone  !== undefined ? { defaultTimeZone:  input.defaultTimeZone }  : {}),
            ...(input.dateFormatCode   !== undefined ? { dateFormatCode:   input.dateFormatCode }   : {}),
            ...(input.firstDayOfWeek   !== undefined ? { firstDayOfWeek:   input.firstDayOfWeek }   : {}),
            updatedAt: now,
          })
          .where(eq(tenantLocaleConfigs.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`))
          .returning(),
      );
      result = updated[0]!;
    } else {
      const inserted = await withTenantContext(this.db, tenantId, async (tx) =>
        tx.insert(tenantLocaleConfigs).values({
          id:               randomUUID(),
          tenantId:         tenantId as `${string}-${string}-${string}-${string}-${string}`,
          defaultLocale:    input.defaultLocale    ?? 'en-GB',
          fallbackLocale:   input.fallbackLocale   ?? 'en-GB',
          supportedLocales: input.supportedLocales ?? ['en-GB'],
          defaultTimeZone:  input.defaultTimeZone  ?? 'Europe/London',
          dateFormatCode:   input.dateFormatCode   ?? 'iso',
          firstDayOfWeek:   input.firstDayOfWeek   ?? 1,
          createdAt:        now,
          updatedAt:        now,
        }).returning(),
      );
      result = inserted[0]!;
    }

    await this.audit.record({
      tenantId,
      actorId,
      actorType:  'user',
      actionType: existing[0] ? 'update' : 'create',
      entityType: 'tenant_locale_config',
      entityId:   result.id,
      afterValue: { ...input },
    });

    return toLocaleConfigDto(result);
  }

  /**
   * Batch-upsert translated labels for all members of a value set.
   * Silently skips codes that don't exist in the set.
   */
  async batchUpsertValueSetLabels(
    setCode:      string,
    localeCode:   string,
    labels:       Record<string, string>,
    actorId:      string,
  ): Promise<void> {
    const sets = await this.db
      .select({ id: valueSets.id })
      .from(valueSets)
      .where(eq(valueSets.setCode, setCode));

    if (!sets[0]) throw new NotFoundError('ValueSet', setCode);

    const members = await this.db
      .select({ id: valueSetMembers.id, code: valueSetMembers.code })
      .from(valueSetMembers)
      .where(eq(valueSetMembers.valueSetId, sets[0].id));

    const memberMap = new Map(members.map((m) => [m.code, m.id]));

    for (const [code, displayLabel] of Object.entries(labels)) {
      const memberId = memberMap.get(code);
      if (!memberId) continue;
      await this.db
        .insert(valueSetMemberLabels)
        .values({
          id:               randomUUID(),
          valueSetMemberId: memberId,
          localeCode,
          displayLabel,
          description:      null,
        })
        .onConflictDoUpdate({
          target: [valueSetMemberLabels.valueSetMemberId, valueSetMemberLabels.localeCode],
          set:    { displayLabel },
        });
    }

    await this.audit.record({
      actorId,
      actorType:  'user',
      actionType: 'update',
      entityType: 'value_set_labels',
      entityId:   sets[0].id,
      afterValue: { setCode, localeCode, labelCount: Object.keys(labels).length },
    });
  }

  /**
   * Add a translated label for a value set member.
   * Replaces any existing label for the same (member, locale) pair.
   */
  async addValueSetMemberLabel(
    input: AddValueSetMemberLabelInput,
    actorId: string,
  ): Promise<ValueSetMemberLabelDto> {
    // Verify the member exists
    const members = await this.db
      .select({ id: valueSetMembers.id })
      .from(valueSetMembers)
      .where(eq(valueSetMembers.id, input.valueSetMemberId as `${string}-${string}-${string}-${string}-${string}`));

    if (!members[0]) throw new NotFoundError('ValueSetMember', input.valueSetMemberId);

    // Upsert the label
    const inserted = await this.db
      .insert(valueSetMemberLabels)
      .values({
        id:               randomUUID(),
        valueSetMemberId: input.valueSetMemberId as `${string}-${string}-${string}-${string}-${string}`,
        localeCode:       input.localeCode,
        displayLabel:     input.displayLabel,
        description:      input.description ?? null,
      })
      .onConflictDoUpdate({
        target: [valueSetMemberLabels.valueSetMemberId, valueSetMemberLabels.localeCode],
        set:    { displayLabel: input.displayLabel, description: input.description ?? null },
      })
      .returning();

    await this.audit.record({
      actorId,
      actorType:  'user',
      actionType: 'create',
      entityType: 'value_set_member_label',
      entityId:   inserted[0]!.id,
      afterValue: { ...input },
    });

    return toLabelDto(inserted[0]!);
  }

  /**
   * Get translated labels for all members of a value set, resolved for the
   * given locale with fallback. Returns one entry per member.
   *
   * Resolution order: targetLocale → fallbackLocale → base display_label (en-GB).
   */
  async getValueSetLabels(
    setCode: string,
    targetLocale: string,
    fallbackLocale: string,
  ): Promise<ResolvedLabel[]> {
    const sets = await this.db
      .select({ id: valueSets.id })
      .from(valueSets)
      .where(eq(valueSets.setCode, setCode));

    if (!sets[0]) throw new NotFoundError('ValueSet', setCode);

    const members = await this.db
      .select({
        id:           valueSetMembers.id,
        code:         valueSetMembers.code,
        displayLabel: valueSetMembers.displayLabel,
      })
      .from(valueSetMembers)
      .where(eq(valueSetMembers.valueSetId, sets[0].id));

    if (members.length === 0) return [];

    const memberIds = members.map((m) => m.id);
    const localeCodes = [...new Set([targetLocale, fallbackLocale])].filter(
      (lc) => lc !== 'en-GB',
    );

    const translations = localeCodes.length > 0
      ? await this.db
          .select()
          .from(valueSetMemberLabels)
          .where(and(
            inArray(valueSetMemberLabels.valueSetMemberId, memberIds),
            inArray(valueSetMemberLabels.localeCode, localeCodes),
          ))
      : [];

    return members.map((member) => {
      const targetTx = translations.find(
        (t) => t.valueSetMemberId === member.id && t.localeCode === targetLocale,
      );
      if (targetTx) {
        return { code: member.code, displayLabel: targetTx.displayLabel, locale: targetLocale, isFallback: false };
      }
      const fallbackTx = translations.find(
        (t) => t.valueSetMemberId === member.id && t.localeCode === fallbackLocale,
      );
      if (fallbackTx) {
        return { code: member.code, displayLabel: fallbackTx.displayLabel, locale: fallbackLocale, isFallback: true };
      }
      return { code: member.code, displayLabel: member.displayLabel, locale: 'en-GB', isFallback: true };
    });
  }

  async #assertLocaleExists(localeCode: string): Promise<void> {
    const rows = await this.db
      .select({ id: localeResourcePacks.id })
      .from(localeResourcePacks)
      .where(and(
        eq(localeResourcePacks.localeCode, localeCode),
        eq(localeResourcePacks.active, true),
      ));
    if (!rows[0]) {
      throw new ValidationError(`Locale '${localeCode}' is not an active locale resource pack`);
    }
  }
}

// ── Mappers ──────────────────────────────────────────────────────────────────

function toLocalePackDto(r: typeof localeResourcePacks.$inferSelect): LocaleResourcePackDto {
  return {
    localeCode:        r.localeCode,
    displayName:       r.displayName,
    nativeDisplayName: r.nativeDisplayName,
    isRtl:             r.isRtl,
    isPlatformDefault: r.isPlatformDefault,
    active:            r.active,
  };
}

function toLocaleConfigDto(r: typeof tenantLocaleConfigs.$inferSelect): TenantLocaleConfigDto {
  return {
    tenantLocaleConfigId: r.id,
    tenantId:             r.tenantId,
    defaultLocale:        r.defaultLocale,
    fallbackLocale:       r.fallbackLocale,
    supportedLocales:     r.supportedLocales ?? ['en-GB'],
    defaultTimeZone:      r.defaultTimeZone,
    dateFormatCode:       r.dateFormatCode,
    firstDayOfWeek:       r.firstDayOfWeek,
    updatedAt:            r.updatedAt,
  };
}

function toLabelDto(r: typeof valueSetMemberLabels.$inferSelect): ValueSetMemberLabelDto {
  return {
    valueSetMemberLabelId: r.id,
    valueSetMemberId:      r.valueSetMemberId,
    localeCode:            r.localeCode,
    displayLabel:          r.displayLabel,
    description:           r.description ?? null,
    createdAt:             r.createdAt,
  };
}
