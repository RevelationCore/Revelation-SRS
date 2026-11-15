/**
 * Inbound flows: what adjacent systems report about a student (F-LIB-SIS-01
 * library account, F-ACC-SIS-01 accommodation booking), from a connector or
 * entered by staff. Append-only history with the latest observation per
 * record current; informational only (AJ-17: a fine does not block results,
 * and housing check-in is not academic status).
 */
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startTestApp, type TestApp } from './helpers/test-app.js';

let ctx: TestApp;
let registryJwt: string;
let connectorJwt: string;
let tutorJwt: string;

beforeAll(async () => {
  ctx = await startTestApp();
  registryJwt = await ctx.makeJwt();
  connectorJwt = await ctx.makeJwt({ roles: ['integration-service'] });
  tutorJwt = await ctx.makeJwt({ roles: ['personal-tutor'] });
}, 120_000);

afterAll(async () => {
  await ctx?.teardown();
});

const LIB = 'F-LIB-SIS-01';
const ACC = 'F-ACC-SIS-01';
const libraryAccount = { accountStatus: 'active', loansOnIssue: 3, overdueItems: 1, outstandingBalancePence: 250 };

describe('Inbound flows', () => {
  it('registers every inbound flow and says how each is handled', async () => {
    const flows = (await get('/api/v1/inbound-flows', tutorJwt)).json<Array<{ flowCode: string; handling: string; handlingNote?: string }>>();
    const by = (h: string) => flows.filter((f) => f.handling === h).map((f) => f.flowCode).sort();
    expect(by('record')).toEqual(['F-ACC-SIS-01', 'F-ITSM-SIS-01', 'F-LIB-SIS-01', 'F-PAY-SIS-01', 'F-RP-SIS-01']);
    expect(by('dedicated')).toEqual(['F-CM-SIS-01', 'F-CRM-SIS-01', 'F-OIV-SIS-01']);
    expect(by('not-per-student')).toEqual(['F-CMS-SIS-01', 'F-EST-SIS-01', 'F-SETS-SIS-01']);
    expect(flows.find((f) => f.flowCode === 'F-OIV-SIS-01')?.handlingNote).toContain('identity-verifications');
  });

  it('records payroll, studentship and service-desk reports with their value sets', async () => {
    const f = await fixture('IN107');
    const pay = await post('/api/v1/inbound/F-PAY-SIS-01', { personId: f.personId, idempotencyKey: 'pay-1',
      payload: { paymentReference: 'PAY-9', paymentType: 'bursary', amountPence: 50_000, paidOn: '2026-10-31' } }, connectorJwt);
    expect(pay.statusCode, pay.body).toBe(201);
    expect(pay.json<{ summary: string }>().summary).toBe('bursary payment PAY-9: £500.00 paid 2026-10-31');

    const rp = await post('/api/v1/inbound/F-RP-SIS-01', { personId: f.personId, idempotencyKey: 'rp-1',
      payload: { awardReference: 'EPSRC-1', funder: 'EPSRC', awardStatus: 'active', startDate: '2026-10-01' } }, connectorJwt);
    expect(rp.statusCode, rp.body).toBe(201);

    const itsm = await post('/api/v1/inbound/F-ITSM-SIS-01', { personId: f.personId, idempotencyKey: 'it-1',
      payload: { ticketReference: 'INC-42', outcome: 'account-unlocked' } }, connectorJwt);
    expect(itsm.statusCode, itsm.body).toBe(201);
    expect((await post('/api/v1/inbound/F-ITSM-SIS-01', { personId: f.personId, idempotencyKey: 'it-2',
      payload: { ticketReference: 'INC-43', outcome: 'rebooted' } }, connectorJwt)).statusCode).toBe(422);
  });

  it('a connector reports a library account by student number; a repeat is recognised', async () => {
    const f = await fixture('IN101');
    const body = { studentNumber: f.studentNumber, payload: libraryAccount, observedAt: '2026-10-01T09:00:00.000Z', idempotencyKey: 'lib-IN101-1' };

    const first = await post(`/api/v1/inbound/${LIB}`, body, connectorJwt);
    expect(first.statusCode, first.body).toBe(201);
    expect(first.json()).toMatchObject({
      personId: f.personId, recordKey: 'account', receivedVia: 'connector', current: true,
      summary: 'Library account active: 3 on loan, 1 overdue, £2.50 outstanding',
    });
    const repeat = await post(`/api/v1/inbound/${LIB}`, body, connectorJwt);
    expect(repeat.statusCode).toBe(200);
    expect(repeat.json<{ externalRecordId: string }>().externalRecordId).toBe(first.json<{ externalRecordId: string }>().externalRecordId);
  });

  it('validates against the flow\'s fields and value sets', async () => {
    const f = await fixture('IN102');
    const send = (payload: Record<string, unknown>, flow = LIB) =>
      post(`/api/v1/inbound/${flow}`, { personId: f.personId, payload, idempotencyKey: `k-${Math.random()}` }, connectorJwt);

    expect((await send({ ...libraryAccount, accountStatus: 'frozen' })).statusCode).toBe(422);
    expect((await send({ ...libraryAccount, outstandingBalancePence: -5 })).statusCode).toBe(422);
    expect((await send({ accountStatus: 'active' })).statusCode).toBe(422);
    const dedicated = await send({ anything: 1 }, 'F-CRM-SIS-01');
    expect(dedicated.statusCode).toBe(422);
    expect(dedicated.body).toContain('admissions');
    expect((await post(`/api/v1/inbound/${LIB}`, { studentNumber: 'NOPE', payload: libraryAccount, idempotencyKey: 'x' }, connectorJwt)).statusCode).toBe(404);
  });

  it('keeps history: the latest observation of each record is current', async () => {
    const f = await fixture('IN103');
    await post(`/api/v1/inbound/${LIB}`, { personId: f.personId, payload: libraryAccount, observedAt: '2026-10-01T09:00:00.000Z', idempotencyKey: 'a' }, connectorJwt);
    await post(`/api/v1/inbound/${LIB}`, { personId: f.personId, payload: { ...libraryAccount, overdueItems: 0, outstandingBalancePence: 0 }, observedAt: '2026-10-08T09:00:00.000Z', idempotencyKey: 'b' }, connectorJwt);
    for (const ref of ['B-1', 'B-2']) {
      await post(`/api/v1/inbound/${ACC}`, {
        personId: f.personId, idempotencyKey: `acc-${ref}`,
        payload: { bookingReference: ref, bookingStatus: 'checked-in', roomReference: 'R12', startDate: '2026-09-21' },
      }, connectorJwt);
    }

    const records = (await get(`/api/v1/students/${f.personId}/external-records`, tutorJwt)).json<Array<{ flowCode: string; recordKey: string; current: boolean; payload: Record<string, unknown> }>>();
    const library = records.filter((r) => r.flowCode === LIB);
    expect(library.map((r) => [r.current, r.payload['overdueItems']])).toEqual([[true, 0], [false, 1]]);
    expect(records.filter((r) => r.flowCode === ACC && r.current).map((r) => r.recordKey).sort()).toEqual(['B-1', 'B-2']);
  });

  it('staff enter a record by hand where no connector exists (audited)', async () => {
    const f = await fixture('IN104');
    const res = await post(`/api/v1/students/${f.personId}/external-records/${ACC}`, {
      payload: { bookingReference: 'HALL-7', bookingStatus: 'checked-out', endDate: '2027-06-20' },
    }, registryJwt);
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json()).toMatchObject({ receivedVia: 'person', summary: 'Booking HALL-7 checked-out to 2027-06-20' });
    const audit = await ctx.db.execute(sql`SELECT count(*)::int AS n FROM audit_record WHERE entity_type = 'external_record' AND entity_id = ${res.json<{ externalRecordId: string }>().externalRecordId}`);
    expect(audit[0]?.['n']).toBe(1);
  });

  it('never changes academic status', async () => {
    const f = await fixture('IN105');
    await post(`/api/v1/inbound/${LIB}`, { personId: f.personId, payload: { ...libraryAccount, accountStatus: 'suspended', outstandingBalancePence: 12_000 }, idempotencyKey: 'fine' }, connectorJwt);
    await post(`/api/v1/inbound/${ACC}`, { personId: f.personId, payload: { bookingReference: 'B-9', bookingStatus: 'checked-out' }, idempotencyKey: 'out' }, connectorJwt);

    const enrolment = await get(`/api/v1/enrolments/${f.enrolmentId}`, registryJwt);
    expect(enrolment.json<{ statusCode: string }>().statusCode).toBe('enrolled');
  });

  it('separates permissions: connectors report, staff read and enter', async () => {
    const f = await fixture('IN106');
    expect((await post(`/api/v1/inbound/${LIB}`, { personId: f.personId, payload: libraryAccount, idempotencyKey: 'p' }, registryJwt)).statusCode).toBe(403);
    expect((await post(`/api/v1/students/${f.personId}/external-records/${LIB}`, { payload: libraryAccount }, tutorJwt)).statusCode).toBe(403);
    const student = await ctx.makeJwt({ roles: ['student'], srsPersonId: f.personId });
    expect((await get(`/api/v1/students/${f.personId}/external-records`, student)).statusCode).toBe(403);
  });
});

async function fixture(code: string): Promise<{ personId: string; studentNumber: string; enrolmentId: string }> {
  const student = (await post('/api/v1/students', { legalFirstName: code, legalFamilyName: 'Inbound' }, registryJwt)).json<{ personId: string; studentNumber: string }>();
  const enrolment = await post('/api/v1/enrolments', {
    personId: student.personId, modeOfStudyCode: 'full-time', academicYearOfEntry: '2026-27', startDate: '2026-09-21',
  }, registryJwt);
  return { ...student, enrolmentId: enrolment.json<{ enrolmentId: string }>().enrolmentId };
}

function get(url: string, token: string) {
  return ctx.app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${token}` } });
}

function post(url: string, payload: Record<string, unknown>, token: string) {
  return ctx.app.inject({ method: 'POST', url, headers: { authorization: `Bearer ${token}` }, payload });
}
