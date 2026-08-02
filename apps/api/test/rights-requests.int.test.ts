import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startTestApp, type TestApp } from './helpers/test-app.js';

let ctx: TestApp;
let jwt: string;
let dpoJwt: string;

beforeAll(async () => {
  ctx    = await startTestApp();
  jwt    = await ctx.makeJwt();
  dpoJwt = await ctx.makeJwt({ roles: ['dpo'] });
}, 120_000);

afterAll(async () => { await ctx?.teardown(); });

async function createPerson(legalFirstName: string, legalFamilyName: string): Promise<string> {
  const res = await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/students',
    headers: { authorization: `Bearer ${jwt}` },
    payload: { legalFirstName, legalFamilyName },
  });
  expect(res.statusCode).toBe(201);
  return res.json<{ personId: string }>().personId;
}

describe('Individual rights, retention & disposal (BPR-D18)', () => {
  it('opens a DSAR, records scope/search, decides, and applies a restriction', async () => {
    const personId = await createPerson('DSAR', 'Subject');

    const openRequest = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/rights-requests',
      headers: { authorization: `Bearer ${dpoJwt}` },
      payload: {
        personId,
        requestTypeCode: 'access',
        statutoryDeadlineDate: '2027-11-01',
        ownerId: 'dpo-01',
      },
    });
    expect(openRequest.statusCode).toBe(201);
    const { requestId } = openRequest.json<{ requestId: string }>();

    const scope = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/rights-requests/${requestId}/scope`,
      headers: { authorization: `Bearer ${dpoJwt}` },
      payload: { scopeEntityType: 'person_identity', scopeDescription: 'All held personal data' },
    });
    expect(scope.statusCode).toBe(201);

    const search = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/rights-requests/${requestId}/search-manifest`,
      headers: { authorization: `Bearer ${dpoJwt}` },
      payload: { searchedSystem: 'srs-core', recordCount: 12 },
    });
    expect(search.statusCode).toBe(201);

    const decision = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/rights-requests/${requestId}/decision`,
      headers: { authorization: `Bearer ${dpoJwt}` },
      payload: { decisionTypeCode: 'granted' },
    });
    expect(decision.statusCode).toBe(201);
    const { decisionId } = decision.json<{ decisionId: string }>();

    const restriction = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/rights-restrictions',
      headers: { authorization: `Bearer ${dpoJwt}` },
      payload: { personId, restrictionTypeCode: 'no-marketing', rightsDecisionId: decisionId },
    });
    expect(restriction.statusCode).toBe(201);
    const { restrictionId } = restriction.json<{ restrictionId: string }>();

    const lift = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/v1/rights-restrictions/${restrictionId}/lift`,
      headers: { authorization: `Bearer ${dpoJwt}` },
    });
    expect(lift.statusCode).toBe(204);
  });

  it('blocks disposition while a hold is active, and allows it once lifted is recorded on a fresh assignment', async () => {
    const personId = await createPerson('Retention', 'Subject');

    const schedule = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/retention-schedules',
      headers: { authorization: `Bearer ${dpoJwt}` },
      payload: { entityType: 'person', retentionPeriodMonths: '72', triggerEventCode: 'end-of-study' },
    });
    expect(schedule.statusCode).toBe(201);
    const { retentionScheduleId } = schedule.json<{ retentionScheduleId: string }>();

    const assignment = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/retention-schedules/${retentionScheduleId}/assignments`,
      headers: { authorization: `Bearer ${dpoJwt}` },
      payload: { entityType: 'person', entityId: personId, scheduledDisposalDate: '2033-09-20' },
    });
    expect(assignment.statusCode).toBe(201);
    const { retentionAssignmentId } = assignment.json<{ retentionAssignmentId: string }>();

    const hold = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/retention-assignments/${retentionAssignmentId}/holds`,
      headers: { authorization: `Bearer ${dpoJwt}` },
      payload: { holdReasonCode: 'litigation' },
    });
    expect(hold.statusCode).toBe(201);

    const blockedDisposition = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/retention-assignments/${retentionAssignmentId}/disposition`,
      headers: { authorization: `Bearer ${dpoJwt}` },
      payload: { dispositionTypeCode: 'anonymised' },
    });
    expect(blockedDisposition.statusCode).toBe(422);

    // A fresh assignment with no hold can be disposed of.
    const assignment2 = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/retention-schedules/${retentionScheduleId}/assignments`,
      headers: { authorization: `Bearer ${dpoJwt}` },
      payload: { entityType: 'person', entityId: personId },
    });
    expect(assignment2.statusCode).toBe(201);
    const { retentionAssignmentId: assignmentId2 } = assignment2.json<{ retentionAssignmentId: string }>();

    const disposition = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/retention-assignments/${assignmentId2}/disposition`,
      headers: { authorization: `Bearer ${dpoJwt}` },
      payload: { dispositionTypeCode: 'anonymised' },
    });
    expect(disposition.statusCode).toBe(201);

    // Both assignments, schedules and the original request are now browsable rather than write-only.
    const requestsList = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/rights-requests',
      headers: { authorization: `Bearer ${dpoJwt}` },
    });
    expect(requestsList.statusCode).toBe(200);

    const schedulesList = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/retention-schedules',
      headers: { authorization: `Bearer ${dpoJwt}` },
    });
    expect(schedulesList.statusCode).toBe(200);
    expect(schedulesList.json<Array<{ retentionScheduleId: string }>>())
      .toContainEqual(expect.objectContaining({ retentionScheduleId }));

    const assignmentsList = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/retention-assignments?retentionScheduleId=${retentionScheduleId}`,
      headers: { authorization: `Bearer ${dpoJwt}` },
    });
    expect(assignmentsList.statusCode).toBe(200);
    const assignments = assignmentsList.json<Array<{ retentionAssignmentId: string; hasActiveHold: boolean; disposed: boolean }>>();
    expect(assignments).toContainEqual(expect.objectContaining({ retentionAssignmentId, hasActiveHold: true, disposed: false }));
    expect(assignments).toContainEqual(expect.objectContaining({ retentionAssignmentId: assignmentId2, hasActiveHold: false, disposed: true }));
  });
});
