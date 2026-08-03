import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startTestApp, type TestApp } from './helpers/test-app.js';

let ctx: TestApp;

beforeAll(async () => {
  ctx = await startTestApp();
}, 120_000);

afterAll(async () => {
  await ctx?.teardown();
});

// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/v1/students', () => {
  it('returns 401 when no token is provided', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url:    '/api/v1/students',
      payload: { legalFirstName: 'Alice', legalFamilyName: 'Smith' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 403 when role is student (insufficient permission)', async () => {
    const jwt = await ctx.makeJwt({ roles: ['student'] });
    const res = await ctx.app.inject({
      method:  'POST',
      url:     '/api/v1/students',
      headers: { authorization: `Bearer ${jwt}` },
      payload: { legalFirstName: 'Alice', legalFamilyName: 'Smith' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('creates a student and returns 201 with personId and studentNumber', async () => {
    const jwt = await ctx.makeJwt();
    const res = await ctx.app.inject({
      method:  'POST',
      url:     '/api/v1/students',
      headers: { authorization: `Bearer ${jwt}` },
      payload: {
        legalFirstName:  'Alice',
        legalFamilyName: 'Smith',
        emailPersonal:   'alice.smith@example.com',
        genderCode:      '2',
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json<{ personId: string; studentNumber: string }>();
    expect(body.personId).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.studentNumber).toBeTruthy();
  });

  it('returns 422 when a coded personal data value is not in the value set', async () => {
    const jwt = await ctx.makeJwt();
    const res = await ctx.app.inject({
      method:  'POST',
      url:     '/api/v1/students',
      headers: { authorization: `Bearer ${jwt}` },
      payload: {
        legalFirstName:  'Invalid',
        legalFamilyName: 'Gender',
        genderCode:      'not-a-hesa-code',
      },
    });
    expect(res.statusCode).toBe(422);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/v1/students/:id', () => {
  let createdPersonId: string;

  beforeAll(async () => {
    const jwt = await ctx.makeJwt();
    const res = await ctx.app.inject({
      method:  'POST',
      url:     '/api/v1/students',
      headers: { authorization: `Bearer ${jwt}` },
      payload: { legalFirstName: 'Bob', legalFamilyName: 'Jones' },
    });
    createdPersonId = res.json<{ personId: string }>().personId;
  });

  it('returns 404 for an unknown personId', async () => {
    const jwt = await ctx.makeJwt();
    const res = await ctx.app.inject({
      method:  'GET',
      url:     '/api/v1/students/00000000-0000-0000-0000-000000000000',
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns 200 with student and current identity', async () => {
    const jwt = await ctx.makeJwt();
    const res = await ctx.app.inject({
      method:  'GET',
      url:     `/api/v1/students/${createdPersonId}`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ personId: string; identity: { legalFirstName: string } | null }>();
    expect(body.personId).toBe(createdPersonId);
    expect(body.identity?.legalFirstName).toBe('Bob');
  });

  it('does not expose a student to a different tenant', async () => {
    const jwt = await ctx.makeJwt({ tenantId: ctx.secondTenantId });
    const res = await ctx.app.inject({
      method:  'GET',
      url:     `/api/v1/students/${createdPersonId}`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(res.statusCode).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('PATCH /api/v1/students/:id/hesa-id', () => {
  let personId: string;

  beforeAll(async () => {
    const jwt = await ctx.makeJwt();
    const res = await ctx.app.inject({
      method:  'POST',
      url:     '/api/v1/students',
      headers: { authorization: `Bearer ${jwt}` },
      payload: { legalFirstName: 'Hesa', legalFamilyName: 'Identifier' },
    });
    personId = res.json<{ personId: string }>().personId;
  });

  it('updates the HESA identifier and returns it on the student record', async () => {
    const jwt = await ctx.makeJwt();
    const patch = await ctx.app.inject({
      method:  'PATCH',
      url:     `/api/v1/students/${personId}/hesa-id`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: { hesaId: 'HESA1234567890' },
    });
    expect(patch.statusCode).toBe(204);

    const get = await ctx.app.inject({
      method:  'GET',
      url:     `/api/v1/students/${personId}`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(get.statusCode).toBe(200);
    expect(get.json<{ hesaId: string | null }>().hesaId).toBe('HESA1234567890');
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('PATCH /api/v1/students/:id/identity', () => {
  let personId: string;

  beforeAll(async () => {
    const jwt = await ctx.makeJwt();
    const res = await ctx.app.inject({
      method:  'POST',
      url:     '/api/v1/students',
      headers: { authorization: `Bearer ${jwt}` },
      payload: { legalFirstName: 'Carol', legalFamilyName: 'Brown' },
    });
    personId = res.json<{ personId: string }>().personId;
  });

  it('returns 204 on successful identity update', async () => {
    const jwt = await ctx.makeJwt();
    const res = await ctx.app.inject({
      method:  'PATCH',
      url:     `/api/v1/students/${personId}/identity`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: { preferredName: 'Caz', emailPersonal: 'caz@example.com' },
    });
    expect(res.statusCode).toBe(204);
  });

  it('returns 422 when an updated coded value is invalid', async () => {
    const jwt = await ctx.makeJwt();
    const res = await ctx.app.inject({
      method:  'PATCH',
      url:     `/api/v1/students/${personId}/identity`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: { genderCode: 'not-a-hesa-code' },
    });
    expect(res.statusCode).toBe(422);
  });

  it('identity-history returns 2 versions after the update', async () => {
    const jwt = await ctx.makeJwt();
    const res = await ctx.app.inject({
      method:  'GET',
      url:     `/api/v1/students/${personId}/identity-history`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(res.statusCode).toBe(200);
    const versions = res.json<Array<{ versionId: string }>>();
    expect(versions.length).toBe(2);
  });

  it('current GET shows updated preferred name', async () => {
    const jwt = await ctx.makeJwt();
    const res = await ctx.app.inject({
      method:  'GET',
      url:     `/api/v1/students/${personId}`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    const body = res.json<{ identity: { preferredName: string | null } }>();
    expect(body.identity?.preferredName).toBe('Caz');
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('Identity verification checks', () => {
  let personId: string;
  let verificationCheckId: string;

  beforeAll(async () => {
    const jwt = await ctx.makeJwt();
    const res = await ctx.app.inject({
      method:  'POST',
      url:     '/api/v1/students',
      headers: { authorization: `Bearer ${jwt}` },
      payload: { legalFirstName: 'Ivy', legalFamilyName: 'Verify' },
    });
    personId = res.json<{ personId: string }>().personId;
  });

  it('requests identity verification', async () => {
    const jwt = await ctx.makeJwt();
    const res = await ctx.app.inject({
      method:  'POST',
      url:     `/api/v1/students/${personId}/identity-verifications`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: { providerReference: 'OIV-123' },
    });
    expect(res.statusCode).toBe(201);
    verificationCheckId = res.json<{ verificationCheckId: string }>().verificationCheckId;
    expect(verificationCheckId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('completes identity verification', async () => {
    const jwt = await ctx.makeJwt();
    const res = await ctx.app.inject({
      method:  'POST',
      url:     `/api/v1/students/${personId}/identity-verifications/${verificationCheckId}/completion`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: {
        statusCode:       'verified',
        confidenceScore:  92,
        providerReference: 'OIV-123',
      },
    });
    expect(res.statusCode).toBe(204);
  });

  it('lists the current completed verification check', async () => {
    const jwt = await ctx.makeJwt();
    const res = await ctx.app.inject({
      method:  'GET',
      url:     `/api/v1/students/${personId}/identity-verifications`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(res.statusCode).toBe(200);
    const checks = res.json<Array<{ verificationCheckId: string; statusCode: string; confidenceScore: number }>>();
    expect(checks).toHaveLength(1);
    expect(checks[0]).toMatchObject({
      verificationCheckId,
      statusCode: 'verified',
      confidenceScore: 92,
    });
  });

  it('returns 422 when completing the same verification twice', async () => {
    const jwt = await ctx.makeJwt();
    const res = await ctx.app.inject({
      method:  'POST',
      url:     `/api/v1/students/${personId}/identity-verifications/${verificationCheckId}/completion`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: { statusCode: 'failed' },
    });
    expect(res.statusCode).toBe(422);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/v1/students/:id/addresses', () => {
  let personId: string;

  beforeAll(async () => {
    const jwt = await ctx.makeJwt();
    const res = await ctx.app.inject({
      method:  'POST',
      url:     '/api/v1/students',
      headers: { authorization: `Bearer ${jwt}` },
      payload: { legalFirstName: 'Dave', legalFamilyName: 'Wilson' },
    });
    personId = res.json<{ personId: string }>().personId;
  });

  it('returns 201 and an addressId', async () => {
    const jwt = await ctx.makeJwt();
    const res = await ctx.app.inject({
      method:  'POST',
      url:     `/api/v1/students/${personId}/addresses`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: {
        addressTypeCode: 'home',
        line1:           '10 Main Street',
        city:            'Oxford',
        postcode:        'OX1 1AA',
        countryCode:     'GB',
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json<{ addressId: string }>();
    expect(body.addressId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('GET addresses returns the address', async () => {
    const jwt = await ctx.makeJwt();
    const res = await ctx.app.inject({
      method:  'GET',
      url:     `/api/v1/students/${personId}/addresses`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(res.statusCode).toBe(200);
    const addresses = res.json<Array<{ addressTypeCode: string; city: string | null }>>();
    expect(addresses.some((a) => a.addressTypeCode === 'home' && a.city === 'Oxford')).toBe(true);
  });

  it('GET a single address by id', async () => {
    const jwt = await ctx.makeJwt();
    const list = await ctx.app.inject({
      method: 'GET', url: `/api/v1/students/${personId}/addresses`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    const addressId = list.json<Array<{ id: string }>>()[0]!.id;

    const res = await ctx.app.inject({
      method: 'GET', url: `/api/v1/students/${personId}/addresses/${addressId}`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ city: string | null }>().city).toBe('Oxford');
  });

  it('DELETE removes the address so it no longer appears in the list', async () => {
    const jwt = await ctx.makeJwt();
    const create = await ctx.app.inject({
      method: 'POST', url: `/api/v1/students/${personId}/addresses`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: { addressTypeCode: 'term-time', line1: '1 College Road' },
    });
    const addressId = create.json<{ addressId: string }>().addressId;

    const del = await ctx.app.inject({
      method: 'DELETE', url: `/api/v1/students/${personId}/addresses/${addressId}`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(del.statusCode).toBe(204);

    const get = await ctx.app.inject({
      method: 'GET', url: `/api/v1/students/${personId}/addresses/${addressId}`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(get.statusCode).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/v1/students/:id/disability-declarations', () => {
  let personId: string;

  beforeAll(async () => {
    const jwt = await ctx.makeJwt();
    const res = await ctx.app.inject({
      method:  'POST',
      url:     '/api/v1/students',
      headers: { authorization: `Bearer ${jwt}` },
      payload: { legalFirstName: 'Eve', legalFamilyName: 'Taylor' },
    });
    personId = res.json<{ personId: string }>().personId;
  });

  it('returns 403 for a module-tutor (insufficient permission)', async () => {
    const jwt = await ctx.makeJwt({ roles: ['module-tutor'] });
    const res = await ctx.app.inject({
      method:  'POST',
      url:     `/api/v1/students/${personId}/disability-declarations`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: { disabilityCategoryCode: '05' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('returns 201 for an authorised role', async () => {
    const jwt = await ctx.makeJwt();
    const res = await ctx.app.inject({
      method:  'POST',
      url:     `/api/v1/students/${personId}/disability-declarations`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: { disabilityCategoryCode: '05' },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json<{ declarationId: string }>();
    expect(body.declarationId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('PATCH updates notes and sets status to updated', async () => {
    const jwt = await ctx.makeJwt();
    const create = await ctx.app.inject({
      method: 'POST', url: `/api/v1/students/${personId}/disability-declarations`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: { disabilityCategoryCode: '06' },
    });
    const declarationId = create.json<{ declarationId: string }>().declarationId;

    const patch = await ctx.app.inject({
      method: 'PATCH', url: `/api/v1/students/${personId}/disability-declarations/${declarationId}`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: { notes: 'Updated context' },
    });
    expect(patch.statusCode).toBe(204);

    const list = await ctx.app.inject({
      method: 'GET', url: `/api/v1/students/${personId}/disability-declarations`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    const updated = list.json<Array<{ declarationId: string; declarationStatusCode: string; notes: string | null }>>()
      .find(d => d.declarationId === declarationId);
    expect(updated).toMatchObject({ declarationStatusCode: 'updated', notes: 'Updated context' });
  });

  it('withdrawal sets status to withdrawn and rejects further edits', async () => {
    const jwt = await ctx.makeJwt();
    const create = await ctx.app.inject({
      method: 'POST', url: `/api/v1/students/${personId}/disability-declarations`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: { disabilityCategoryCode: '07' },
    });
    const declarationId = create.json<{ declarationId: string }>().declarationId;

    const withdraw = await ctx.app.inject({
      method: 'POST', url: `/api/v1/students/${personId}/disability-declarations/${declarationId}/withdrawal`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(withdraw.statusCode).toBe(204);

    const list = await ctx.app.inject({
      method: 'GET', url: `/api/v1/students/${personId}/disability-declarations`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    const withdrawn = list.json<Array<{ declarationId: string; declarationStatusCode: string }>>()
      .find(d => d.declarationId === declarationId);
    expect(withdrawn?.declarationStatusCode).toBe('withdrawn');

    const secondWithdraw = await ctx.app.inject({
      method: 'POST', url: `/api/v1/students/${personId}/disability-declarations/${declarationId}/withdrawal`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(secondWithdraw.statusCode).toBe(422);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Self-scoped enrolment detail routes (portal enrolment detail page). The
// admin-only /enrolments/:id/* routes require enrolment:read:all; students
// need their own view, hence these /students/:personId/enrolments/:id/*
// routes with requireSelfOrPermission.

describe('Self-scoped enrolment detail routes', () => {
  let personId: string;
  let enrolmentId: string;
  let studentJwt: string;

  beforeAll(async () => {
    const adminJwt = await ctx.makeJwt();
    const student = await ctx.app.inject({
      method: 'POST', url: '/api/v1/students', headers: { authorization: `Bearer ${adminJwt}` },
      payload: { legalFirstName: 'Fay', legalFamilyName: 'Enrolled' },
    });
    personId = student.json<{ personId: string }>().personId;

    const enrolment = await ctx.app.inject({
      method: 'POST', url: '/api/v1/enrolments', headers: { authorization: `Bearer ${adminJwt}` },
      payload: { personId, modeOfStudyCode: 'full-time', academicYearOfEntry: '2026-27', startDate: '2026-09-21' },
    });
    enrolmentId = enrolment.json<{ enrolmentId: string }>().enrolmentId;

    studentJwt = await ctx.makeJwt({ roles: ['student'], tenantId: ctx.tenantId, srsPersonId: personId });
  });

  it('lets a student read their own enrolment detail, history, transitions and fees', async () => {
    const detail = await ctx.app.inject({
      method: 'GET', url: `/api/v1/students/${personId}/enrolments/${enrolmentId}`,
      headers: { authorization: `Bearer ${studentJwt}` },
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json<{ enrolmentId: string }>().enrolmentId).toBe(enrolmentId);

    const history = await ctx.app.inject({
      method: 'GET', url: `/api/v1/students/${personId}/enrolments/${enrolmentId}/history`,
      headers: { authorization: `Bearer ${studentJwt}` },
    });
    expect(history.statusCode).toBe(200);
    expect(history.json<unknown[]>().length).toBeGreaterThan(0);

    const transitions = await ctx.app.inject({
      method: 'GET', url: `/api/v1/students/${personId}/enrolments/${enrolmentId}/transitions`,
      headers: { authorization: `Bearer ${studentJwt}` },
    });
    expect(transitions.statusCode).toBe(200);

    const fees = await ctx.app.inject({
      method: 'GET', url: `/api/v1/students/${personId}/enrolments/${enrolmentId}/fee-liabilities`,
      headers: { authorization: `Bearer ${studentJwt}` },
    });
    expect(fees.statusCode).toBe(200);
  });

  it('does not let a student read another student\'s enrolment via their own personId route', async () => {
    const otherStudent = await ctx.app.inject({
      method: 'POST', url: '/api/v1/students', headers: { authorization: `Bearer ${await ctx.makeJwt()}` },
      payload: { legalFirstName: 'Gus', legalFamilyName: 'Other' },
    });
    const otherPersonId = otherStudent.json<{ personId: string }>().personId;

    // studentJwt's srsPersonId is `personId`, not otherPersonId, so
    // requireSelfOrPermission itself blocks this at the personId param check.
    const res = await ctx.app.inject({
      method: 'GET', url: `/api/v1/students/${otherPersonId}/enrolments/${enrolmentId}`,
      headers: { authorization: `Bearer ${studentJwt}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it('returns 404 when the enrolmentId does not belong to the personId in the route', async () => {
    const otherAdminJwt = await ctx.makeJwt();
    const otherStudent = await ctx.app.inject({
      method: 'POST', url: '/api/v1/students', headers: { authorization: `Bearer ${otherAdminJwt}` },
      payload: { legalFirstName: 'Gus', legalFamilyName: 'Other' },
    });
    const otherPersonId = otherStudent.json<{ personId: string }>().personId;
    const otherEnrolment = await ctx.app.inject({
      method: 'POST', url: '/api/v1/enrolments', headers: { authorization: `Bearer ${otherAdminJwt}` },
      payload: { personId: otherPersonId, modeOfStudyCode: 'full-time', academicYearOfEntry: '2026-27', startDate: '2026-09-21' },
    });
    const otherEnrolmentId = otherEnrolment.json<{ enrolmentId: string }>().enrolmentId;

    // Same tenant, same requester personId in the route (passes
    // requireSelfOrPermission), but the enrolmentId belongs to someone else.
    const res = await ctx.app.inject({
      method: 'GET', url: `/api/v1/students/${personId}/enrolments/${otherEnrolmentId}`,
      headers: { authorization: `Bearer ${studentJwt}` },
    });
    expect(res.statusCode).toBe(404);
  });
});
