import { randomUUID } from 'node:crypto';

import { and, desc, eq, lte } from 'drizzle-orm';
import {
  currencies,
  exchangeRates,
  tenantCurrencyConfigs,
  type Db,
  withTenantContext,
} from '@revelation-srs/db';
import { NotFoundError, ValidationError, type MonetaryAmount } from '@revelation-srs/domain';

import type { AuditService } from '../audit/service.js';

// ── DTOs ─────────────────────────────────────────────────────────────────────

export interface CurrencyDto {
  currencyCode: string;
  numericCode:  string | null;
  displayName:  string;
  symbol:       string | null;
  minorUnits:   number;
  active:       boolean;
}

export interface ExchangeRateDto {
  exchangeRateId:   string;
  fromCurrencyCode: string;
  toCurrencyCode:   string;
  rate:             string;
  effectiveDate:    string;
  source:           string;
  sourceReference:  string | null;
  recordedAt:       Date;
  recordedBy:       string;
}

export interface RecordExchangeRateInput {
  fromCurrencyCode: string;
  toCurrencyCode:   string;
  rate:             string;
  effectiveDate:    string;
  source:           string;
  sourceReference?: string;
}

export interface TenantCurrencyConfigDto {
  tenantCurrencyConfigId:     string;
  tenantId:                   string;
  defaultCurrencyCode:        string;
  acceptedCurrencies:         string[];
  requiresConversionEvidence: boolean;
  updatedAt:                  Date;
}

export interface UpsertTenantCurrencyConfigInput {
  defaultCurrencyCode?:        string;
  acceptedCurrencies?:         string[];
  requiresConversionEvidence?: boolean;
}

// ── Service ───────────────────────────────────────────────────────────────────

export class CurrencyService {
  constructor(
    private readonly db: Db,
    private readonly audit: AuditService,
  ) {}

  async listCurrencies(activeOnly = true): Promise<CurrencyDto[]> {
    const rows = await this.db
      .select()
      .from(currencies)
      .orderBy(currencies.currencyCode);

    return rows
      .filter((r) => !activeOnly || r.active)
      .map(toCurrencyDto);
  }

  async getCurrency(currencyCode: string): Promise<CurrencyDto> {
    const rows = await this.db
      .select()
      .from(currencies)
      .where(eq(currencies.currencyCode, currencyCode));

    if (!rows[0]) throw new NotFoundError('Currency', currencyCode);
    return toCurrencyDto(rows[0]);
  }

  async getTenantCurrencyConfig(tenantId: string): Promise<TenantCurrencyConfigDto> {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx.select().from(tenantCurrencyConfigs)
        .where(eq(tenantCurrencyConfigs.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`)),
    );

    if (rows[0]) return toCurrencyConfigDto(rows[0]);

    // Auto-provision default config
    return this.upsertTenantCurrencyConfig(tenantId, {}, 'system');
  }

  async upsertTenantCurrencyConfig(
    tenantId: string,
    input: UpsertTenantCurrencyConfigInput,
    actorId: string,
  ): Promise<TenantCurrencyConfigDto> {
    if (input.defaultCurrencyCode !== undefined) {
      await this.#assertCurrencyExists(input.defaultCurrencyCode);
    }
    if (input.acceptedCurrencies !== undefined) {
      for (const code of input.acceptedCurrencies) {
        await this.#assertCurrencyExists(code);
      }
    }

    const now = new Date();
    const existing = await withTenantContext(this.db, tenantId, async (tx) =>
      tx.select({ id: tenantCurrencyConfigs.id }).from(tenantCurrencyConfigs)
        .where(eq(tenantCurrencyConfigs.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`)),
    );

    let result: typeof tenantCurrencyConfigs.$inferSelect;

    if (existing[0]) {
      const updated = await withTenantContext(this.db, tenantId, async (tx) =>
        tx.update(tenantCurrencyConfigs)
          .set({
            ...(input.defaultCurrencyCode        !== undefined ? { defaultCurrencyCode:        input.defaultCurrencyCode }        : {}),
            ...(input.acceptedCurrencies          !== undefined ? { acceptedCurrencies:          input.acceptedCurrencies }          : {}),
            ...(input.requiresConversionEvidence  !== undefined ? { requiresConversionEvidence:  input.requiresConversionEvidence }  : {}),
            updatedAt: now,
          })
          .where(eq(tenantCurrencyConfigs.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`))
          .returning(),
      );
      result = updated[0]!;
    } else {
      const inserted = await withTenantContext(this.db, tenantId, async (tx) =>
        tx.insert(tenantCurrencyConfigs).values({
          id:                         randomUUID(),
          tenantId:                   tenantId as `${string}-${string}-${string}-${string}-${string}`,
          defaultCurrencyCode:        input.defaultCurrencyCode        ?? 'GBP',
          acceptedCurrencies:         input.acceptedCurrencies          ?? ['GBP'],
          requiresConversionEvidence: input.requiresConversionEvidence  ?? false,
          createdAt:                  now,
          updatedAt:                  now,
        }).returning(),
      );
      result = inserted[0]!;
    }

    await this.audit.record({
      tenantId,
      actorId,
      actorType:  'user',
      actionType: existing[0] ? 'update' : 'create',
      entityType: 'tenant_currency_config',
      entityId:   result.id,
      afterValue: { ...input },
    });

    return toCurrencyConfigDto(result);
  }

  async recordExchangeRate(
    input: RecordExchangeRateInput,
    actorId: string,
  ): Promise<ExchangeRateDto> {
    await this.#assertCurrencyExists(input.fromCurrencyCode);
    await this.#assertCurrencyExists(input.toCurrencyCode);

    if (input.fromCurrencyCode === input.toCurrencyCode) {
      throw new ValidationError('from and to currency codes must differ');
    }

    const rateNum = parseFloat(input.rate);
    if (isNaN(rateNum) || rateNum <= 0) {
      throw new ValidationError('rate must be a positive decimal number');
    }

    const inserted = await this.db
      .insert(exchangeRates)
      .values({
        fromCurrencyCode: input.fromCurrencyCode,
        toCurrencyCode:   input.toCurrencyCode,
        rate:             input.rate,
        effectiveDate:    input.effectiveDate,
        source:           input.source,
        sourceReference:  input.sourceReference ?? null,
        recordedBy:       actorId,
      })
      .onConflictDoUpdate({
        target: [exchangeRates.fromCurrencyCode, exchangeRates.toCurrencyCode, exchangeRates.effectiveDate],
        set:    {
          rate:            input.rate,
          source:          input.source,
          sourceReference: input.sourceReference ?? null,
          recordedAt:      new Date(),
          recordedBy:      actorId,
        },
      })
      .returning();

    await this.audit.record({
      actorId,
      actorType:  'user',
      actionType: 'create',
      entityType: 'exchange_rate',
      entityId:   inserted[0]!.id,
      afterValue: { fromCurrencyCode: input.fromCurrencyCode, toCurrencyCode: input.toCurrencyCode, effectiveDate: input.effectiveDate },
    });

    return toExchangeRateDto(inserted[0]!);
  }

  /**
   * Get the most recently recorded exchange rate on or before effectiveDate.
   * Returns null if no rate is available.
   */
  async getCurrentExchangeRate(
    fromCurrencyCode: string,
    toCurrencyCode: string,
    effectiveDate: string,
  ): Promise<ExchangeRateDto | null> {
    const rows = await this.db
      .select()
      .from(exchangeRates)
      .where(and(
        eq(exchangeRates.fromCurrencyCode, fromCurrencyCode),
        eq(exchangeRates.toCurrencyCode, toCurrencyCode),
        lte(exchangeRates.effectiveDate, effectiveDate),
      ))
      .orderBy(desc(exchangeRates.effectiveDate), desc(exchangeRates.recordedAt))
      .limit(1);

    return rows[0] ? toExchangeRateDto(rows[0]) : null;
  }

  /**
   * Convert a MonetaryAmount from one currency to another using the most
   * recent available exchange rate on or before the given date.
   * Throws if no rate is available and the currencies differ.
   */
  async convert(
    amount: MonetaryAmount,
    toCurrencyCode: string,
    effectiveDate: string,
  ): Promise<{ result: MonetaryAmount; rateUsed: ExchangeRateDto }> {
    if (amount.currencyCode === toCurrencyCode) {
      const currency = await this.getCurrency(toCurrencyCode);
      return {
        result:   { ...amount, currencyCode: toCurrencyCode, minorUnits: currency.minorUnits },
        rateUsed: {
          exchangeRateId:   '',
          fromCurrencyCode: amount.currencyCode,
          toCurrencyCode,
          rate:             '1.0000000000',
          effectiveDate,
          source:           'identity',
          sourceReference:  null,
          recordedAt:       new Date(),
          recordedBy:       'system',
        },
      };
    }

    const rate = await this.getCurrentExchangeRate(amount.currencyCode, toCurrencyCode, effectiveDate);
    if (!rate) {
      throw new ValidationError(
        `No exchange rate available for ${amount.currencyCode}→${toCurrencyCode} on or before ${effectiveDate}`,
      );
    }

    const toCurrency = await this.getCurrency(toCurrencyCode);
    const rateNum = parseFloat(rate.rate);
    const sourceUnits = Number(amount.amount);
    const convertedUnits = BigInt(Math.round(sourceUnits * rateNum));

    return {
      result: {
        amount:       convertedUnits,
        currencyCode: toCurrencyCode,
        minorUnits:   toCurrency.minorUnits,
      },
      rateUsed: rate,
    };
  }

  async #assertCurrencyExists(currencyCode: string): Promise<void> {
    const rows = await this.db
      .select({ id: currencies.id })
      .from(currencies)
      .where(and(eq(currencies.currencyCode, currencyCode), eq(currencies.active, true)));
    if (!rows[0]) {
      throw new ValidationError(`Currency '${currencyCode}' is not an active ISO 4217 currency`);
    }
  }
}

// ── Mappers ──────────────────────────────────────────────────────────────────

function toCurrencyDto(r: typeof currencies.$inferSelect): CurrencyDto {
  return {
    currencyCode: r.currencyCode,
    numericCode:  r.numericCode ?? null,
    displayName:  r.displayName,
    symbol:       r.symbol ?? null,
    minorUnits:   r.minorUnits,
    active:       r.active,
  };
}

function toExchangeRateDto(r: typeof exchangeRates.$inferSelect): ExchangeRateDto {
  return {
    exchangeRateId:   r.id,
    fromCurrencyCode: r.fromCurrencyCode,
    toCurrencyCode:   r.toCurrencyCode,
    rate:             r.rate,
    effectiveDate:    r.effectiveDate,
    source:           r.source,
    sourceReference:  r.sourceReference ?? null,
    recordedAt:       r.recordedAt,
    recordedBy:       r.recordedBy,
  };
}

function toCurrencyConfigDto(r: typeof tenantCurrencyConfigs.$inferSelect): TenantCurrencyConfigDto {
  return {
    tenantCurrencyConfigId:     r.id,
    tenantId:                   r.tenantId,
    defaultCurrencyCode:        r.defaultCurrencyCode,
    acceptedCurrencies:         r.acceptedCurrencies ?? ['GBP'],
    requiresConversionEvidence: r.requiresConversionEvidence,
    updatedAt:                  r.updatedAt,
  };
}
