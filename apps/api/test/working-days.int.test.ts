import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { addWorkingDaysFor } from '../src/platform/calendar/working-days.js';

import { startTestApp, type TestApp } from './helpers/test-app.js';

/** Working-day calendar for statutory deadlines (Phase 5 D-42). */
let ctx: TestApp;
let admin: string;

beforeAll(async () => {
  ctx = await startTestApp();
  admin = await ctx.makeJwt({ roles: ['tenant-administrator'] });
}, 120_000);

afterAll(async () => { await ctx?.teardown(); });

const call = (method: 'GET' | 'POST' | 'PATCH', url: string, payload?: Record<string, unknown>, tenantToken = admin) =>
  ctx.app.inject({ method, url: `/api/v1${url}`, headers: { authorization: `Bearer ${tenantToken}` }, ...(payload ? { payload } : {}) });

// An extract in the GOV.UK bank-holidays.json format.
const GOV_UK = {
  'england-and-wales': { division: 'england-and-wales', events: [{ title: 'Early May bank holiday', date: '2027-05-03', notes: '', bunting: true }] },
  'scotland': { division: 'scotland', events: [{ title: 'St Andrew’s Day', date: '2027-11-30', notes: '', bunting: true }] },
  'northern-ireland': { division: 'northern-ireland', events: [{ title: 'Battle of the Boyne', date: '2027-07-12', notes: '', bunting: false }] },
};

describe('Working days (D-42)', () => {
  it('a deadline that spans a bank holiday in the tenant\'s division moves by a day', async () => {
    const imported = await call('POST', '/calendar/non-working-days/import', GOV_UK);
    expect(imported.statusCode, imported.body).toBe(200);
    expect(imported.json<{ imported: number }>().imported).toBe(3);

    // Friday 30 April 2027 + 1 working day: Monday 3 May is a bank holiday in England and Wales.
    const from = new Date('2027-04-30T12:00:00Z');
    expect((await addWorkingDaysFor(ctx.db, ctx.tenantId, from, 1, 'statutory')).toISOString().slice(0, 10)).toBe('2027-05-04');

    // In Scotland 3 May is not in this extract, so it stays a working day; 30 November is.
    expect((await call('PATCH', '/tenant/configuration', { calendar: { division: 'scotland' } })).statusCode).toBe(200);
    expect((await addWorkingDaysFor(ctx.db, ctx.tenantId, from, 1, 'statutory')).toISOString().slice(0, 10)).toBe('2027-05-03');
    expect((await addWorkingDaysFor(ctx.db, ctx.tenantId, new Date('2027-11-29T12:00:00Z'), 1, 'statutory')).toISOString().slice(0, 10)).toBe('2027-12-01');
    await call('PATCH', '/tenant/configuration', { calendar: { division: 'england-and-wales' } });
  });

  it('an institution closure day applies whatever the division, and imports do not duplicate', async () => {
    expect((await call('POST', '/calendar/non-working-days', { date: '2027-12-29', description: 'Winter closure' })).statusCode).toBe(201);
    // BL-178 (F-1): a closure day moves an institutional deadline, never a statutory one (FOIA s.10(6), UKVI).
    expect((await addWorkingDaysFor(ctx.db, ctx.tenantId, new Date('2027-12-28T12:00:00Z'), 1, 'institutional')).toISOString().slice(0, 10)).toBe('2027-12-30');
    expect((await addWorkingDaysFor(ctx.db, ctx.tenantId, new Date('2027-12-28T12:00:00Z'), 1, 'statutory')).toISOString().slice(0, 10)).toBe('2027-12-29');
    expect((await call('POST', '/calendar/non-working-days/import', GOV_UK)).json<{ imported: number }>().imported).toBe(0);
    const list = (await call('GET', '/calendar/non-working-days?from=2027-01-01&to=2027-12-31')).json<Array<{ date: string }>>();
    expect(list.map((d) => d.date)).toEqual(['2027-05-03', '2027-07-12', '2027-11-30', '2027-12-29']);
  });

  it('refuses a file that is not in the GOV.UK format, and a fetch the tenant has not turned on', async () => {
    expect((await call('POST', '/calendar/non-working-days/import', { events: [] })).statusCode).toBe(422);
    expect((await call('POST', '/calendar/non-working-days/import', {})).statusCode).toBe(422);
  });
});
