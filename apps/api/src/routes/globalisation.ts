import { requirePermission } from '@revelation-srs/auth';
import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';

import type {
  AddValueSetMemberLabelInput,
  UpsertTenantLocaleConfigInput,
} from '../platform/globalisation/locale-service.js';
import type { RecordExchangeRateInput, UpsertTenantCurrencyConfigInput } from '../platform/globalisation/currency-service.js';

const ErrorSchema = Type.Object({
  type:   Type.String(),
  title:  Type.String(),
  status: Type.Number(),
  detail: Type.Optional(Type.String()),
});

// ── Locale schemas ────────────────────────────────────────────────────────────

const LocalePackSchema = Type.Object({
  localeCode:        Type.String(),
  displayName:       Type.String(),
  nativeDisplayName: Type.String(),
  isRtl:             Type.Boolean(),
  isPlatformDefault: Type.Boolean(),
  active:            Type.Boolean(),
});

const TenantLocaleConfigSchema = Type.Object({
  tenantLocaleConfigId: Type.String(),
  tenantId:             Type.String(),
  defaultLocale:        Type.String(),
  fallbackLocale:       Type.String(),
  supportedLocales:     Type.Array(Type.String()),
  defaultTimeZone:      Type.String(),
  dateFormatCode:       Type.String(),
  firstDayOfWeek:       Type.Number(),
  updatedAt:            Type.String(),
});

const UpsertLocaleConfigBody = Type.Object({
  defaultLocale:    Type.Optional(Type.String({ minLength: 2, maxLength: 35 })),
  fallbackLocale:   Type.Optional(Type.String({ minLength: 2, maxLength: 35 })),
  supportedLocales: Type.Optional(Type.Array(Type.String({ minLength: 2, maxLength: 35 }))),
  defaultTimeZone:  Type.Optional(Type.String({ minLength: 1, maxLength: 80 })),
  dateFormatCode:   Type.Optional(Type.Enum({ iso: 'iso', uk: 'uk', us: 'us', eu: 'eu' })),
  firstDayOfWeek:   Type.Optional(Type.Integer({ minimum: 1, maximum: 7 })),
});

const ResolvedLabelSchema = Type.Object({
  code:         Type.String(),
  displayLabel: Type.String(),
  locale:       Type.String(),
  isFallback:   Type.Boolean(),
});

const ValueSetMemberLabelBody = Type.Object({
  valueSetMemberId: Type.String({ format: 'uuid' }),
  localeCode:       Type.String({ minLength: 2, maxLength: 35 }),
  displayLabel:     Type.String({ minLength: 1, maxLength: 500 }),
  description:      Type.Optional(Type.String()),
});

const ValueSetMemberLabelSchema = Type.Object({
  valueSetMemberLabelId: Type.String(),
  valueSetMemberId:      Type.String(),
  localeCode:            Type.String(),
  displayLabel:          Type.String(),
  description:           Type.Union([Type.String(), Type.Null()]),
  createdAt:             Type.String(),
});

// ── Currency schemas ──────────────────────────────────────────────────────────

const CurrencySchema = Type.Object({
  currencyCode: Type.String(),
  numericCode:  Type.Union([Type.String(), Type.Null()]),
  displayName:  Type.String(),
  symbol:       Type.Union([Type.String(), Type.Null()]),
  minorUnits:   Type.Number(),
  active:       Type.Boolean(),
});

const TenantCurrencyConfigSchema = Type.Object({
  tenantCurrencyConfigId:     Type.String(),
  tenantId:                   Type.String(),
  defaultCurrencyCode:        Type.String(),
  acceptedCurrencies:         Type.Array(Type.String()),
  requiresConversionEvidence: Type.Boolean(),
  updatedAt:                  Type.String(),
});

const UpsertCurrencyConfigBody = Type.Object({
  defaultCurrencyCode:        Type.Optional(Type.String({ minLength: 3, maxLength: 3 })),
  acceptedCurrencies:         Type.Optional(Type.Array(Type.String({ minLength: 3, maxLength: 3 }))),
  requiresConversionEvidence: Type.Optional(Type.Boolean()),
});

const ExchangeRateSchema = Type.Object({
  exchangeRateId:   Type.String(),
  fromCurrencyCode: Type.String(),
  toCurrencyCode:   Type.String(),
  rate:             Type.String(),
  effectiveDate:    Type.String(),
  source:           Type.String(),
  sourceReference:  Type.Union([Type.String(), Type.Null()]),
  recordedAt:       Type.String(),
  recordedBy:       Type.String(),
});

const RecordExchangeRateBody = Type.Object({
  fromCurrencyCode: Type.String({ minLength: 3, maxLength: 3 }),
  toCurrencyCode:   Type.String({ minLength: 3, maxLength: 3 }),
  rate:             Type.String({ minLength: 1, maxLength: 30 }),
  effectiveDate:    Type.String({ pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' }),
  source:           Type.String({ minLength: 1, maxLength: 80 }),
  sourceReference:  Type.Optional(Type.String()),
});

// ── Route registration ────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/require-await
export async function globalisationRoutes(fastify: FastifyInstance): Promise<void> {
  const { localeService, currencyService } = fastify;

  // ── Locales ─────────────────────────────────────────────────────────────────

  fastify.get('/admin/globalisation/locales', {
    preHandler: [requirePermission('globalisation:read')],
    schema: {
      tags:     ['Globalisation'],
      summary:  'List available locale resource packs',
      response: { 200: Type.Array(LocalePackSchema), 401: ErrorSchema, 403: ErrorSchema },
    },
  }, async () => {
    return localeService.listLocaleResourcePacks();
  });

  fastify.get('/admin/globalisation/locale-config', {
    preHandler: [requirePermission('globalisation:read')],
    schema: {
      tags:     ['Globalisation'],
      summary:  'Get the tenant locale and time-zone configuration',
      response: { 200: TenantLocaleConfigSchema, 401: ErrorSchema, 403: ErrorSchema },
    },
  }, async (req) => {
    const config = await localeService.getTenantLocaleConfig(req.tenantId);
    return { ...config, updatedAt: config.updatedAt.toISOString() };
  });

  fastify.put('/admin/globalisation/locale-config', {
    preHandler: [requirePermission('globalisation:write')],
    schema: {
      tags:     ['Globalisation'],
      summary:  'Update the tenant locale and time-zone configuration',
      body:     UpsertLocaleConfigBody,
      response: { 200: TenantLocaleConfigSchema, 400: ErrorSchema, 401: ErrorSchema, 403: ErrorSchema },
    },
  }, async (req) => {
    const body = req.body as UpsertTenantLocaleConfigInput;
    const config = await localeService.upsertTenantLocaleConfig(req.tenantId, body, req.user.sub);
    return { ...config, updatedAt: config.updatedAt.toISOString() };
  });

  // ── Value set member labels ──────────────────────────────────────────────────

  fastify.post('/admin/globalisation/value-set-labels', {
    preHandler: [requirePermission('globalisation:write')],
    schema: {
      tags:     ['Globalisation'],
      summary:  'Add or update a translated label for a value set member',
      body:     ValueSetMemberLabelBody,
      response: { 201: ValueSetMemberLabelSchema, 400: ErrorSchema, 401: ErrorSchema, 403: ErrorSchema, 404: ErrorSchema },
    },
  }, async (req, reply) => {
    const body = req.body as AddValueSetMemberLabelInput;
    const label = await localeService.addValueSetMemberLabel(body, req.user.sub);
    reply.code(201);
    return { ...label, createdAt: label.createdAt.toISOString() };
  });

  fastify.get('/admin/globalisation/value-set-labels/:setCode', {
    preHandler: [requirePermission('globalisation:read')],
    schema: {
      tags:     ['Globalisation'],
      summary:  'Get translated labels for all members of a value set',
      params:   Type.Object({ setCode: Type.String() }),
      querystring: Type.Object({
        locale:         Type.Optional(Type.String()),
        fallbackLocale: Type.Optional(Type.String()),
      }),
      response: { 200: Type.Array(ResolvedLabelSchema), 401: ErrorSchema, 403: ErrorSchema, 404: ErrorSchema },
    },
  }, async (req) => {
    const { setCode } = req.params as { setCode: string };
    const { locale, fallbackLocale } = req.query as { locale?: string; fallbackLocale?: string };
    const tenantConfig = await localeService.getTenantLocaleConfig(req.tenantId);
    const target   = locale         ?? tenantConfig.defaultLocale;
    const fallback = fallbackLocale ?? tenantConfig.fallbackLocale;
    return localeService.getValueSetLabels(setCode, target, fallback);
  });

  // ── Currencies ───────────────────────────────────────────────────────────────

  fastify.get('/admin/globalisation/currencies', {
    preHandler: [requirePermission('globalisation:read')],
    schema: {
      tags:     ['Globalisation'],
      summary:  'List active ISO 4217 currencies',
      response: { 200: Type.Array(CurrencySchema), 401: ErrorSchema, 403: ErrorSchema },
    },
  }, async () => {
    return currencyService.listCurrencies();
  });

  fastify.get('/admin/globalisation/currency-config', {
    preHandler: [requirePermission('globalisation:read')],
    schema: {
      tags:     ['Globalisation'],
      summary:  'Get the tenant currency configuration',
      response: { 200: TenantCurrencyConfigSchema, 401: ErrorSchema, 403: ErrorSchema },
    },
  }, async (req) => {
    const config = await currencyService.getTenantCurrencyConfig(req.tenantId);
    return { ...config, updatedAt: config.updatedAt.toISOString() };
  });

  fastify.put('/admin/globalisation/currency-config', {
    preHandler: [requirePermission('globalisation:write')],
    schema: {
      tags:     ['Globalisation'],
      summary:  'Update the tenant currency configuration',
      body:     UpsertCurrencyConfigBody,
      response: { 200: TenantCurrencyConfigSchema, 400: ErrorSchema, 401: ErrorSchema, 403: ErrorSchema },
    },
  }, async (req) => {
    const body = req.body as UpsertTenantCurrencyConfigInput;
    const config = await currencyService.upsertTenantCurrencyConfig(req.tenantId, body, req.user.sub);
    return { ...config, updatedAt: config.updatedAt.toISOString() };
  });

  // ── Exchange rates ────────────────────────────────────────────────────────────

  fastify.post('/admin/globalisation/exchange-rates', {
    preHandler: [requirePermission('globalisation:write')],
    schema: {
      tags:     ['Globalisation'],
      summary:  'Record an exchange rate',
      body:     RecordExchangeRateBody,
      response: { 201: ExchangeRateSchema, 400: ErrorSchema, 401: ErrorSchema, 403: ErrorSchema },
    },
  }, async (req, reply) => {
    const body = req.body as RecordExchangeRateInput;
    const rate = await currencyService.recordExchangeRate(body, req.user.sub);
    reply.code(201);
    return { ...rate, recordedAt: rate.recordedAt.toISOString() };
  });

  fastify.get('/admin/globalisation/exchange-rates', {
    preHandler: [requirePermission('globalisation:read')],
    schema: {
      tags:     ['Globalisation'],
      summary:  'Look up an exchange rate for a currency pair on a date',
      querystring: Type.Object({
        from:          Type.String({ minLength: 3, maxLength: 3 }),
        to:            Type.String({ minLength: 3, maxLength: 3 }),
        effectiveDate: Type.String({ pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' }),
      }),
      response: {
        200: ExchangeRateSchema,
        404: ErrorSchema,
        401: ErrorSchema,
        403: ErrorSchema,
      },
    },
  }, async (req, reply) => {
    const { from, to, effectiveDate } = req.query as { from: string; to: string; effectiveDate: string };
    const rate = await currencyService.getCurrentExchangeRate(from, to, effectiveDate);
    if (!rate) {
      reply.code(404);
      return {
        type: '/errors/not-found', title: 'Not Found', status: 404,
        detail: `No exchange rate for ${from}→${to} on or before ${effectiveDate}`,
      };
    }
    return { ...rate, recordedAt: rate.recordedAt.toISOString() };
  });
}
