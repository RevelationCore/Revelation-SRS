import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { selectionFixtures } from './helpers/selection-fixtures.js';
import { startTestApp, type TestApp } from './helpers/test-app.js';

/** Confirmed registrations to timetabling, F-SIS-TTB-01 (Phase 4 D-26; BP-03-006). */
let ctx: TestApp;
let f: ReturnType<typeof selectionFixtures>;
let integration: string;

beforeAll(async () => {
  ctx = await startTestApp();
  integration = await ctx.makeJwt({ sub: 'ttb-connector', roles: ['tenant-administrator'] });
  f = selectionFixtures(ctx, { staff: await ctx.makeJwt(), admin: await ctx.makeJwt({ roles: ['tenant-administrator'] }) });
}, 120_000);

afterAll(async () => { await ctx?.teardown(); });

interface Item { deliveryItemId: string; subjectId: string; statusCode: string; failureReason: string | null; payload: Record<string, unknown> }
const items = async (subjectId: string) =>
  (await f.inject('GET', `/api/v1/delivery-items?flowCode=F-SIS-TTB-01&subjectId=${subjectId}`, undefined, integration)).json<Item[]>();

describe('Timetable demand', () => {
  it('sends add on registration and remove on withdrawal, with no personal data beyond the student number', async () => {
    const periodId = await f.period();
    const programmeId = await f.programme();
    const { moduleId, code } = await f.module();
    const offeringId = await f.offering(moduleId, periodId);
    const { enrolmentId } = await f.student(programmeId);
    const reg = await f.inject('POST', '/api/v1/module-registrations', { enrolmentId, moduleOfferingId: offeringId, registrationDate: '2026-10-01' });
    expect(reg.statusCode).toBe(201);
    const registrationId = reg.json<{ moduleRegistrationId: string }>().moduleRegistrationId;

    let sent = await items(registrationId);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.payload).toMatchObject({ kind: 'registration', action: 'add', moduleCode: code, moduleOfferingId: offeringId, registrationStatusCode: 'registered' });
    expect(Object.keys(sent[0]!.payload)).not.toEqual(expect.arrayContaining(['legalFirstName', 'email']));

    expect((await f.inject('POST', `/api/v1/module-registrations/${registrationId}/withdrawal`, {})).statusCode).toBeLessThan(300);
    sent = await items(registrationId);
    expect(sent.map((i) => [i.payload['action'], i.statusCode])).toEqual([['add', 'superseded'], ['remove', 'pending']]);
  });

  it('a roster snapshot per offering; an unchanged roster is not re-sent; a count mismatch on acknowledgement is a failure', async () => {
    const periodId = await f.period();
    const programmeId = await f.programme();
    const { moduleId } = await f.module();
    const offeringId = await f.offering(moduleId, periodId);
    for (let n = 0; n < 2; n += 1) {
      const { enrolmentId } = await f.student(programmeId);
      expect((await f.inject('POST', '/api/v1/module-registrations', { enrolmentId, moduleOfferingId: offeringId, registrationDate: '2026-10-01' })).statusCode).toBe(201);
    }
    const run = async () => (await f.inject('POST', '/api/v1/delivery-flows/F-SIS-TTB-01/run', { academicPeriodId: periodId }, integration)).json<{ created: number; unchanged: number }>();
    expect(await run()).toMatchObject({ created: 1, unchanged: 0 });
    expect(await run()).toMatchObject({ created: 0, unchanged: 1 });

    const [snapshot] = await items(offeringId);
    expect(snapshot!.payload).toMatchObject({ kind: 'snapshot', count: 2 });
    expect((await f.inject('POST', `/api/v1/delivery-items/${snapshot!.deliveryItemId}/acknowledge`, { targetCount: 1 }, integration)).statusCode).toBe(204);
    const [after] = await items(offeringId);
    expect(after).toMatchObject({ statusCode: 'failed', failureReason: expect.stringContaining('count-mismatch') });
    expect((await f.inject('POST', `/api/v1/delivery-items/${snapshot!.deliveryItemId}/acknowledge`, { targetCount: 2 }, integration)).statusCode).toBe(204);
    expect((await items(offeringId))[0]!.statusCode).toBe('delivered');
  });
});
