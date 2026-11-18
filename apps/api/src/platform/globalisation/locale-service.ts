import { randomUUID } from 'node:crypto';

import { and, eq } from 'drizzle-orm';
import {
  localeResourcePacks,
  tenantLocaleConfigs,
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

