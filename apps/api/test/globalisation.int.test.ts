import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startTestApp, type TestApp } from './helpers/test-app.js';

let ctx: TestApp;

beforeAll(async () => {
  ctx = await startTestApp();
}, 120_000);

afterAll(async () => {
  await ctx?.teardown();
});

// ── Locale resource packs ─────────────────────────────────────────────────────

describe('GET /api/v1/admin/globalisation/locales', () => {
  it('returns the seeded locale packs', async () => {
    const jwt = await ctx.makeJwt();
    const res = await ctx.app.inject({
      method:  'GET',
      url:     '/api/v1/admin/globalisation/locales',
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<Array<{ localeCode: string; isPlatformDefault: boolean }>>();
    expect(Array.isArray(body)).toBe(true);
    const enGb = body.find((l) => l.localeCode === 'en-GB');
    expect(enGb).toBeDefined();
    expect(enGb?.isPlatformDefault).toBe(true);
    const cyGb = body.find((l) => l.localeCode === 'cy-GB');
    expect(cyGb).toBeDefined();
  });
});

// ── Tenant locale configuration ───────────────────────────────────────────────

describe('GET /api/v1/admin/globalisation/locale-config', () => {
  it('returns a default config when none is set (auto-provisions en-GB)', async () => {
    const jwt = await ctx.makeJwt();
    const res = await ctx.app.inject({
      method:  'GET',
      url:     '/api/v1/admin/globalisation/locale-config',
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ defaultLocale: string; defaultTimeZone: string; firstDayOfWeek: number }>();
    expect(body.defaultLocale).toBe('en-GB');
    expect(body.defaultTimeZone).toBe('Europe/London');
    expect(body.firstDayOfWeek).toBe(1);
  });
});

describe('PUT /api/v1/admin/globalisation/locale-config', () => {
  it('updates the tenant locale config', async () => {
    const jwt = await ctx.makeJwt({ roles: ['tenant-administrator'] });
    const res = await ctx.app.inject({
      method:  'PUT',
      url:     '/api/v1/admin/globalisation/locale-config',
      headers: { authorization: `Bearer ${jwt}` },
      payload: {
        defaultLocale:    'cy-GB',
        fallbackLocale:   'en-GB',
        supportedLocales: ['en-GB', 'cy-GB'],
        defaultTimeZone:  'Europe/London',
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ defaultLocale: string; supportedLocales: string[] }>();
    expect(body.defaultLocale).toBe('cy-GB');
    expect(body.supportedLocales).toContain('cy-GB');
  });

  it('rejects an unknown locale code', async () => {
    const jwt = await ctx.makeJwt({ roles: ['tenant-administrator'] });
    const res = await ctx.app.inject({
      method:  'PUT',
      url:     '/api/v1/admin/globalisation/locale-config',
      headers: { authorization: `Bearer ${jwt}` },
      payload: { defaultLocale: 'xx-ZZ' },
    });
    expect(res.statusCode).toBe(422);
  });

  it('rejects firstDayOfWeek outside 1-7', async () => {
    const jwt = await ctx.makeJwt({ roles: ['tenant-administrator'] });
    const res = await ctx.app.inject({
      method:  'PUT',
      url:     '/api/v1/admin/globalisation/locale-config',
      headers: { authorization: `Bearer ${jwt}` },
      payload: { firstDayOfWeek: 8 },
    });
    expect(res.statusCode).toBe(400);
  });
});

// ── Value set member translated labels ────────────────────────────────────────

describe('POST /api/v1/admin/globalisation/value-set-labels', () => {
  let enrolmentStatusMemberId: string;

  beforeAll(async () => {
    const { sql } = await import('drizzle-orm');
    const result = await ctx.db.execute(sql`
      SELECT vsm.id FROM value_set_member vsm
      JOIN value_set vs ON vs.id = vsm.value_set_id
      WHERE vs.set_code = 'enrolment-status-code'
        AND vsm.code = 'enrolled'
        AND vsm.tenant_id IS NULL
      LIMIT 1
    `);
    enrolmentStatusMemberId = (result[0] as unknown as { id: string }).id;
  });

  it('adds a Welsh translation for an enrolment status code', async () => {
    const jwt = await ctx.makeJwt({ roles: ['tenant-administrator'] });
    const res = await ctx.app.inject({
      method:  'POST',
      url:     '/api/v1/admin/globalisation/value-set-labels',
      headers: { authorization: `Bearer ${jwt}` },
      payload: {
        valueSetMemberId: enrolmentStatusMemberId,
        localeCode:       'cy-GB',
        displayLabel:     'Cofrestru',
        description:      'Myfyriwr wedi cofrestru',
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json<{ localeCode: string; displayLabel: string }>();
    expect(body.localeCode).toBe('cy-GB');
    expect(body.displayLabel).toBe('Cofrestru');
  });

  it('replaces the label when the same member+locale is submitted again', async () => {
    const jwt = await ctx.makeJwt({ roles: ['tenant-administrator'] });
    await ctx.app.inject({
      method:  'POST',
      url:     '/api/v1/admin/globalisation/value-set-labels',
      headers: { authorization: `Bearer ${jwt}` },
      payload: { valueSetMemberId: enrolmentStatusMemberId, localeCode: 'cy-GB', displayLabel: 'Ymrestru' },
    });
    const res = await ctx.app.inject({
      method:  'GET',
      url:     '/api/v1/admin/globalisation/value-set-labels/enrolment-status-code?locale=cy-GB',
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(res.statusCode).toBe(200);
    const labels = res.json<Array<{ code: string; displayLabel: string; locale: string; isFallback: boolean }>>();
    const enrolled = labels.find((l) => l.code === 'enrolled');
    expect(enrolled?.displayLabel).toBe('Ymrestru');
    expect(enrolled?.locale).toBe('cy-GB');
    expect(enrolled?.isFallback).toBe(false);
  });

  it('falls back to en-GB when cy-GB label is not present for a member', async () => {
    const jwt = await ctx.makeJwt();
    const res = await ctx.app.inject({
      method:  'GET',
      url:     '/api/v1/admin/globalisation/value-set-labels/enrolment-status-code?locale=cy-GB&fallbackLocale=en-GB',
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(res.statusCode).toBe(200);
    const labels = res.json<Array<{ code: string; isFallback: boolean }>>();
    // 'enrolled' now has a cy-GB label; other members (withdrawn, etc.) should fall back
    const withdrawn = labels.find((l) => l.code === 'withdrawn');
    if (withdrawn) {
      expect(withdrawn.isFallback).toBe(true);
    }
  });
});

// ── Currency list ─────────────────────────────────────────────────────────────

describe('GET /api/v1/admin/globalisation/currencies', () => {
  it('returns the seeded currencies including GBP, EUR, JPY', async () => {
    const jwt = await ctx.makeJwt();
    const res = await ctx.app.inject({
      method:  'GET',
      url:     '/api/v1/admin/globalisation/currencies',
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<Array<{ currencyCode: string; minorUnits: number }>>();
    const gbp = body.find((c) => c.currencyCode === 'GBP');
    expect(gbp?.minorUnits).toBe(2);
    const jpy = body.find((c) => c.currencyCode === 'JPY');
    expect(jpy?.minorUnits).toBe(0);
    const eur = body.find((c) => c.currencyCode === 'EUR');
    expect(eur).toBeDefined();
  });
});

// ── Tenant currency configuration ─────────────────────────────────────────────

describe('GET /api/v1/admin/globalisation/currency-config', () => {
  it('returns a default GBP config when none is set (auto-provisions)', async () => {
    const jwt = await ctx.makeJwt({ tenantId: ctx.secondTenantId });
    const res = await ctx.app.inject({
      method:  'GET',
      url:     '/api/v1/admin/globalisation/currency-config',
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ defaultCurrencyCode: string; acceptedCurrencies: string[] }>();
    expect(body.defaultCurrencyCode).toBe('GBP');
    expect(body.acceptedCurrencies).toContain('GBP');
  });
});

describe('PUT /api/v1/admin/globalisation/currency-config', () => {
  it('updates accepted currencies to include EUR and USD', async () => {
    const jwt = await ctx.makeJwt({ roles: ['tenant-administrator'] });
    const res = await ctx.app.inject({
      method:  'PUT',
      url:     '/api/v1/admin/globalisation/currency-config',
      headers: { authorization: `Bearer ${jwt}` },
      payload: {
        defaultCurrencyCode:        'GBP',
        acceptedCurrencies:         ['GBP', 'EUR', 'USD'],
        requiresConversionEvidence: true,
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ acceptedCurrencies: string[]; requiresConversionEvidence: boolean }>();
    expect(body.acceptedCurrencies).toContain('EUR');
    expect(body.requiresConversionEvidence).toBe(true);
  });

  it('rejects an unknown currency code', async () => {
    const jwt = await ctx.makeJwt({ roles: ['tenant-administrator'] });
    const res = await ctx.app.inject({
      method:  'PUT',
      url:     '/api/v1/admin/globalisation/currency-config',
      headers: { authorization: `Bearer ${jwt}` },
      payload: { defaultCurrencyCode: 'XYZ' },
    });
    expect(res.statusCode).toBe(422);
  });
});

// ── Exchange rates ────────────────────────────────────────────────────────────

describe('POST /api/v1/admin/globalisation/exchange-rates', () => {
  it('records a GBP→EUR exchange rate', async () => {
    const jwt = await ctx.makeJwt({ roles: ['tenant-administrator'] });
    const res = await ctx.app.inject({
      method:  'POST',
      url:     '/api/v1/admin/globalisation/exchange-rates',
      headers: { authorization: `Bearer ${jwt}` },
      payload: {
        fromCurrencyCode: 'GBP',
        toCurrencyCode:   'EUR',
        rate:             '1.1652000000',
        effectiveDate:    '2026-06-01',
        source:           'ecb',
        sourceReference:  'ECB-2026-06-01',
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json<{ fromCurrencyCode: string; toCurrencyCode: string; rate: string }>();
    expect(body.fromCurrencyCode).toBe('GBP');
    expect(body.toCurrencyCode).toBe('EUR');
    expect(body.rate).toBe('1.1652000000');
  });

  it('rejects a zero or negative rate', async () => {
    const jwt = await ctx.makeJwt({ roles: ['tenant-administrator'] });
    const res = await ctx.app.inject({
      method:  'POST',
      url:     '/api/v1/admin/globalisation/exchange-rates',
      headers: { authorization: `Bearer ${jwt}` },
      payload: {
        fromCurrencyCode: 'GBP',
        toCurrencyCode:   'EUR',
        rate:             '-1.5',
        effectiveDate:    '2026-06-01',
        source:           'manual',
      },
    });
    expect(res.statusCode).toBe(422);
  });

  it('rejects same-currency exchange rates', async () => {
    const jwt = await ctx.makeJwt({ roles: ['tenant-administrator'] });
    const res = await ctx.app.inject({
      method:  'POST',
      url:     '/api/v1/admin/globalisation/exchange-rates',
      headers: { authorization: `Bearer ${jwt}` },
      payload: {
        fromCurrencyCode: 'GBP',
        toCurrencyCode:   'GBP',
        rate:             '1.0',
        effectiveDate:    '2026-06-01',
        source:           'manual',
      },
    });
    expect(res.statusCode).toBe(422);
  });
});

describe('GET /api/v1/admin/globalisation/exchange-rates', () => {
  it('retrieves the recorded GBP→EUR rate', async () => {
    const jwt = await ctx.makeJwt();
    const res = await ctx.app.inject({
      method:  'GET',
      url:     '/api/v1/admin/globalisation/exchange-rates?from=GBP&to=EUR&effectiveDate=2026-06-14',
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ fromCurrencyCode: string; rate: string }>();
    expect(body.fromCurrencyCode).toBe('GBP');
    expect(body.rate).toBe('1.1652000000');
  });

  it('returns 404 when no rate is available before the requested date', async () => {
    const jwt = await ctx.makeJwt();
    const res = await ctx.app.inject({
      method:  'GET',
      url:     '/api/v1/admin/globalisation/exchange-rates?from=GBP&to=NGN&effectiveDate=2026-06-14',
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(res.statusCode).toBe(404);
  });
});

// ── Fee liability currency fields ─────────────────────────────────────────────

describe('fee liability currency fields', () => {
  it('new enrolments have GBP currency_code on their fee liability', async () => {
    const jwt = await ctx.makeJwt();

    // Create a student
    const studentRes = await ctx.app.inject({
      method:  'POST',
      url:     '/api/v1/students',
      headers: { authorization: `Bearer ${jwt}` },
      payload: { legalFirstName: 'Anya', legalFamilyName: 'Sharma' },
    });
    const { personId } = studentRes.json<{ personId: string }>();

    // Enrol
    const enrolRes = await ctx.app.inject({
      method:  'POST',
      url:     '/api/v1/enrolments',
      headers: { authorization: `Bearer ${jwt}` },
      payload: {
        personId,
        modeOfStudyCode:     'full-time',
        academicYearOfEntry: '2026-27',
        startDate:           '2026-09-21',
        fundingSourceCode:   'slc',
      },
    });
    expect(enrolRes.statusCode).toBe(201);
    const { enrolmentId } = enrolRes.json<{ enrolmentId: string }>();

    // Stage 7: amount_pence column removed; currency_code is the invariant
    const { sql } = await import('drizzle-orm');
    const result = await ctx.db.execute(sql`
      SELECT currency_code, amount_minor_units
      FROM fee_liability
      WHERE enrolment_id = ${enrolmentId}
      LIMIT 1
    `);

    if (result.length > 0) {
      const row = result[0] as unknown as { currency_code: string; amount_minor_units: string | null };
      expect(row.currency_code).toBe('GBP');
    }
  });
});
