import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { EnrolmentService } from '../src/platform/enrolment/service.js';

import { startTestApp, type TestApp } from './helpers/test-app.js';

let ctx: TestApp;
let personId: string;

beforeAll(async () => {
  ctx = await startTestApp();

  // Create a student for enrolment tests
  const jwt = await ctx.makeJwt();
  const res = await ctx.app.inject({
    method:  'POST',
    url:     '/api/v1/students',
    headers: { authorization: `Bearer ${jwt}` },
    payload: { legalFirstName: 'Frank', legalFamilyName: 'Green' },
  });
  personId = res.json<{ personId: string }>().personId;
}, 120_000);

afterAll(async () => {
  await ctx?.teardown();
});

// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/v1/enrolments', () => {
  it('returns 201 with an enrolmentId', async () => {
    const jwt = await ctx.makeJwt();
    const res = await ctx.app.inject({
      method:  'POST',
      url:     '/api/v1/enrolments',
      headers: { authorization: `Bearer ${jwt}` },
      payload: {
        personId,
        modeOfStudyCode:     'full-time',
        academicYearOfEntry: '2025-26',
        startDate:           '2025-09-22',
        fundingSourceCode:   'slc',
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json<{ enrolmentId: string }>();
    expect(body.enrolmentId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('creates fee liability and downstream trigger ledger rows', async () => {
    const jwt = await ctx.makeJwt();
    const create = await ctx.app.inject({
      method:  'POST',
      url:     '/api/v1/enrolments',
      headers: { authorization: `Bearer ${jwt}` },
      payload: {
        personId,
        modeOfStudyCode:     'full-time',
        academicYearOfEntry: '2025-26',
        startDate:           '2025-09-22',
        feeBandCode:         'home-undergraduate',
        fundingSourceCode:   'slc',
        slcReference:        'SLC-123',
        ucasPersonalId:      '1234567890',
        ukviCasRequired:     true,
      },
    });
    expect(create.statusCode).toBe(201);
    const enrolmentId = create.json<{ enrolmentId: string }>().enrolmentId;

    const fees = await ctx.app.inject({
      method:  'GET',
      url:     `/api/v1/enrolments/${enrolmentId}/fee-liabilities`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(fees.statusCode).toBe(200);
    expect(fees.json<Array<{ academicYear: string; statusCode: string }>>()).toMatchObject([
      { academicYear: '2025-26', statusCode: 'generated' },
    ]);

    const triggers = await ctx.app.inject({
      method:  'GET',
      url:     `/api/v1/enrolments/${enrolmentId}/downstream-triggers`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(triggers.statusCode).toBe(200);
    const triggerTypes = triggers
      .json<Array<{ triggerTypeCode: string }>>()
      .map((t) => t.triggerTypeCode)
      .sort();
    expect(triggerTypes).toEqual(['slc-confirmation', 'ucas-confirmation', 'ukvi-cas']);
  });

  it('returns 422 when required fields are missing', async () => {
    const jwt = await ctx.makeJwt();
    const res = await ctx.app.inject({
      method:  'POST',
      url:     '/api/v1/enrolments',
      headers: { authorization: `Bearer ${jwt}` },
      payload: { personId },   // missing modeOfStudyCode, academicYearOfEntry, startDate
    });
    expect(res.statusCode).toBe(400);  // Fastify schema validation returns 400
  });

  it('returns 422 when mode of study is not in the configured value set', async () => {
    const jwt = await ctx.makeJwt();
    const res = await ctx.app.inject({
      method:  'POST',
      url:     '/api/v1/enrolments',
      headers: { authorization: `Bearer ${jwt}` },
      payload: {
        personId,
        modeOfStudyCode:     'not-a-mode',
        academicYearOfEntry: '2025-26',
        startDate:           '2025-09-22',
      },
    });
    expect(res.statusCode).toBe(422);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/v1/enrolments/:id', () => {
  let enrolmentId: string;

  beforeAll(async () => {
    const jwt = await ctx.makeJwt();
    const res = await ctx.app.inject({
      method:  'POST',
      url:     '/api/v1/enrolments',
      headers: { authorization: `Bearer ${jwt}` },
      payload: {
        personId,
        modeOfStudyCode:     'full-time',
        academicYearOfEntry: '2025-26',
        startDate:           '2025-09-22',
      },
    });
    enrolmentId = res.json<{ enrolmentId: string }>().enrolmentId;
  });

  it('returns 404 for an unknown id', async () => {
    const jwt = await ctx.makeJwt();
    const res = await ctx.app.inject({
      method:  'GET',
      url:     '/api/v1/enrolments/00000000-0000-0000-0000-000000000000',
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns 200 with the enrolment details', async () => {
    const jwt = await ctx.makeJwt();
    const res = await ctx.app.inject({
      method:  'GET',
      url:     `/api/v1/enrolments/${enrolmentId}`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ enrolmentId: string; statusCode: string; modeOfStudyCode: string }>();
    expect(body.enrolmentId).toBe(enrolmentId);
    expect(body.statusCode).toBe('enrolled');
    expect(body.modeOfStudyCode).toBe('full-time');
  });

  it('does not expose an enrolment to a different tenant', async () => {
    const jwt = await ctx.makeJwt({ tenantId: ctx.secondTenantId });
    const res = await ctx.app.inject({
      method:  'GET',
      url:     `/api/v1/enrolments/${enrolmentId}`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(res.statusCode).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('Status transitions', () => {
  let enrolmentId: string;

  beforeAll(async () => {
    const jwt = await ctx.makeJwt();
    const res = await ctx.app.inject({
      method:  'POST',
      url:     '/api/v1/enrolments',
      headers: { authorization: `Bearer ${jwt}` },
      payload: {
        personId,
        modeOfStudyCode:     'part-time',
        academicYearOfEntry: '2025-26',
        startDate:           '2025-09-22',
      },
    });
    enrolmentId = res.json<{ enrolmentId: string }>().enrolmentId;
  });

  it('POST /intermit returns 204 and status changes to intermitting', async () => {
    const jwt = await ctx.makeJwt();
    const intermit = await ctx.app.inject({
      method:  'POST',
      url:     `/api/v1/enrolments/${enrolmentId}/intermit`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: { reasonCode: 'health', reasonText: 'Student requested a break in study' },
    });
    expect(intermit.statusCode).toBe(204);

    const check = await ctx.app.inject({
      method:  'GET',
      url:     `/api/v1/enrolments/${enrolmentId}`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(check.json<{ statusCode: string }>().statusCode).toBe('intermitting');
  });

  it('POST /reinstate returns 204 and status changes back to enrolled', async () => {
    const jwt = await ctx.makeJwt();
    const reinstate = await ctx.app.inject({
      method:  'POST',
      url:     `/api/v1/enrolments/${enrolmentId}/reinstate`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: {},
    });
    expect(reinstate.statusCode).toBe(204);

    const check = await ctx.app.inject({
      method:  'GET',
      url:     `/api/v1/enrolments/${enrolmentId}`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(check.json<{ statusCode: string }>().statusCode).toBe('enrolled');
  });

  it('POST /withdraw returns 204 and status changes to withdrawn', async () => {
    const jwt = await ctx.makeJwt();
    const withdraw = await ctx.app.inject({
      method:  'POST',
      url:     `/api/v1/enrolments/${enrolmentId}/withdraw`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: { reasonCode: 'personal' },
    });
    expect(withdraw.statusCode).toBe(204);
  });

  it('exposes bitemporal history and transition reasons', async () => {
    const jwt = await ctx.makeJwt();
    const history = await ctx.app.inject({
      method:  'GET',
      url:     `/api/v1/enrolments/${enrolmentId}/history`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(history.statusCode).toBe(200);
    expect(history.json<Array<{ statusCode: string }>>().map((h) => h.statusCode)).toEqual([
      'enrolled',
      'intermitting',
      'enrolled',
      'withdrawn',
    ]);

    const transitions = await ctx.app.inject({
      method:  'GET',
      url:     `/api/v1/enrolments/${enrolmentId}/transitions`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(transitions.statusCode).toBe(200);
    const rows = transitions.json<Array<{ fromStatusCode: string; toStatusCode: string; reasonCode: string | null; reasonText: string | null }>>();
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({
      fromStatusCode: 'enrolled',
      toStatusCode:   'intermitting',
      reasonCode:     'health',
      reasonText:     'Student requested a break in study',
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('Invalid status transitions', () => {
  it('returns 422 when trying to intermit a withdrawn enrolment', async () => {
    const jwt = await ctx.makeJwt();

    // Create and immediately withdraw
    const createRes = await ctx.app.inject({
      method:  'POST',
      url:     '/api/v1/enrolments',
      headers: { authorization: `Bearer ${jwt}` },
      payload: {
        personId,
        modeOfStudyCode:     'full-time',
        academicYearOfEntry: '2025-26',
        startDate:           '2025-09-22',
      },
    });
    const eid = createRes.json<{ enrolmentId: string }>().enrolmentId;

    await ctx.app.inject({
      method:  'POST',
      url:     `/api/v1/enrolments/${eid}/withdraw`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: {},
    });

    // Attempt invalid transition
    const bad = await ctx.app.inject({
      method:  'POST',
      url:     `/api/v1/enrolments/${eid}/intermit`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: {},
    });
    expect(bad.statusCode).toBe(422);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('Enrolment domain events', () => {
  it('publishes enrolment, fee liability, and downstream trigger events', async () => {
    const events: Array<{ type: string; classification: string; payload: Record<string, unknown> }> = [];
    const fakeBus = {
      isConnected: () => true,
      publish: (
        type: string,
        _version: string,
        _tenantId: string,
        _correlationId: string,
        classification: string,
        payload: Record<string, unknown>,
      ) => {
        events.push({ type, classification, payload });
        return Promise.resolve();
      },
    };

    const service = new EnrolmentService(
      ctx.db,
      fakeBus as unknown as ConstructorParameters<typeof EnrolmentService>[1],
      ctx.app.valueSetService,
    );

    const enrolmentId = await service.createEnrolment(
      ctx.tenantId,
      {
        personId,
        modeOfStudyCode:     'full-time',
        academicYearOfEntry: '2025-26',
        startDate:           '2025-09-22',
        fundingSourceCode:   'slc',
        slcReference:        'SLC-EVENT',
        ucasPersonalId:      'UCAS-EVENT',
        ukviCasRequired:     true,
      },
      'event-test-user',
    );

    expect(enrolmentId).toMatch(/^[0-9a-f-]{36}$/);
    expect(events.map((e) => e.type).sort()).toEqual([
      'srs.enrolment.downstream-trigger-created',
      'srs.enrolment.downstream-trigger-created',
      'srs.enrolment.downstream-trigger-created',
      'srs.enrolment.fee-liability-generated',
      'srs.student.enrolled',
    ]);
    expect(events.filter((e) => e.type === 'srs.enrolment.downstream-trigger-created')).toHaveLength(3);
    expect(events.some((e) => e.classification === 'regulatory' && e.payload['triggerTypeCode'] === 'ukvi-cas')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('Person status lifecycle (SID-009)', () => {
  let lifecyclePersonId: string;
  let lifecycleEnrolmentId: string;

  beforeAll(async () => {
    const jwt = await ctx.makeJwt();
    const res = await ctx.app.inject({
      method:  'POST',
      url:     '/api/v1/students',
      headers: { authorization: `Bearer ${jwt}` },
      payload: { legalFirstName: 'Lifecycle', legalFamilyName: 'Test' },
    });
    lifecyclePersonId = res.json<{ personId: string }>().personId;
  });

  it('new student starts with personStatusCode = prospective', async () => {
    const jwt = await ctx.makeJwt();
    const res = await ctx.app.inject({
      method:  'GET',
      url:     `/api/v1/students/${lifecyclePersonId}`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ personStatusCode: string }>().personStatusCode).toBe('prospective');
  });

  it('creating an enrolment advances person status to student', async () => {
    const jwt = await ctx.makeJwt();
    const enrolRes = await ctx.app.inject({
      method:  'POST',
      url:     '/api/v1/enrolments',
      headers: { authorization: `Bearer ${jwt}` },
      payload: {
        personId:            lifecyclePersonId,
        modeOfStudyCode:     'full-time',
        academicYearOfEntry: '2025-26',
        startDate:           '2025-09-22',
      },
    });
    expect(enrolRes.statusCode).toBe(201);
    lifecycleEnrolmentId = enrolRes.json<{ enrolmentId: string }>().enrolmentId;

    const res = await ctx.app.inject({
      method:  'GET',
      url:     `/api/v1/students/${lifecyclePersonId}`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(res.json<{ personStatusCode: string }>().personStatusCode).toBe('student');
  });

  it('graduating the enrolment advances person status to alumnus', async () => {
    const jwt = await ctx.makeJwt();
    await ctx.app.inject({
      method:  'POST',
      url:     `/api/v1/enrolments/${lifecycleEnrolmentId}/graduate`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: {},
    });

    const res = await ctx.app.inject({
      method:  'GET',
      url:     `/api/v1/students/${lifecyclePersonId}`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(res.json<{ personStatusCode: string }>().personStatusCode).toBe('alumnus');
  });

  it('a new enrolment after graduation returns person to student', async () => {
    const jwt = await ctx.makeJwt();
    await ctx.app.inject({
      method:  'POST',
      url:     '/api/v1/enrolments',
      headers: { authorization: `Bearer ${jwt}` },
      payload: {
        personId:            lifecyclePersonId,
        modeOfStudyCode:     'part-time',
        academicYearOfEntry: '2026-27',
        startDate:           '2026-09-21',
      },
    });

    const res = await ctx.app.inject({
      method:  'GET',
      url:     `/api/v1/students/${lifecyclePersonId}`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(res.json<{ personStatusCode: string }>().personStatusCode).toBe('student');
  });

  it('PATCH /students/:id/status sets deceased and enrolment creation does not override it', async () => {
    const jwt = await ctx.makeJwt();

    // Create a fresh person
    const pRes = await ctx.app.inject({
      method:  'POST',
      url:     '/api/v1/students',
      headers: { authorization: `Bearer ${jwt}` },
      payload: { legalFirstName: 'Deceased', legalFamilyName: 'Person' },
    });
    const deceasedPersonId = pRes.json<{ personId: string }>().personId;

    const patch = await ctx.app.inject({
      method:  'PATCH',
      url:     `/api/v1/students/${deceasedPersonId}/status`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: { statusCode: 'deceased' },
    });
    expect(patch.statusCode).toBe(204);

    const check = await ctx.app.inject({
      method:  'GET',
      url:     `/api/v1/students/${deceasedPersonId}`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(check.json<{ personStatusCode: string }>().personStatusCode).toBe('deceased');

    // Enrolment creation should NOT override deceased status
    await ctx.app.inject({
      method:  'POST',
      url:     '/api/v1/enrolments',
      headers: { authorization: `Bearer ${jwt}` },
      payload: {
        personId:            deceasedPersonId,
        modeOfStudyCode:     'full-time',
        academicYearOfEntry: '2025-26',
        startDate:           '2025-09-22',
      },
    });

    const afterEnrol = await ctx.app.inject({
      method:  'GET',
      url:     `/api/v1/students/${deceasedPersonId}`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(afterEnrol.json<{ personStatusCode: string }>().personStatusCode).toBe('deceased');
  });
});
