import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startTestApp, type TestApp } from './helpers/test-app.js';

let ctx: TestApp;
let jwt: string;

beforeAll(async () => {
  ctx = await startTestApp();
  jwt = await ctx.makeJwt();
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

async function createEnrolment(personId: string): Promise<string> {
  const res = await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/enrolments',
    headers: { authorization: `Bearer ${jwt}` },
    payload: {
      personId,
      modeOfStudyCode: 'full-time',
      academicYearOfEntry: '2027-28',
      startDate: '2027-09-20',
      feeBandCode: 'home-postgraduate-research',
    },
  });
  expect(res.statusCode).toBe(201);
  return res.json<{ enrolmentId: string }>().enrolmentId;
}

async function openReview(enrolmentId: string, reviewTypeCode: string): Promise<string> {
  const res = await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/pgr/reviews',
    headers: { authorization: `Bearer ${jwt}` },
    payload: { enrolmentId, reviewTypeCode, ownerId: 'pgr-admin-01' },
  });
  expect(res.statusCode).toBe(201);
  return res.json<{ reviewId: string }>().reviewId;
}

async function addMember(reviewId: string, personId: string, roleCode: string): Promise<string> {
  const res = await ctx.app.inject({
    method: 'POST',
    url: `/api/v1/pgr/reviews/${reviewId}/members`,
    headers: { authorization: `Bearer ${jwt}` },
    payload: { personId, roleCode },
  });
  expect(res.statusCode).toBe(201);
  return res.json<{ memberId: string }>().memberId;
}

async function recordEvidence(reviewId: string): Promise<void> {
  const res = await ctx.app.inject({
    method: 'POST',
    url: `/api/v1/pgr/reviews/${reviewId}/evidence`,
    headers: { authorization: `Bearer ${jwt}` },
    payload: { evidenceRef: 'annual-report-2028.pdf', classificationCode: 'sensitive-academic', sourceSystem: 'pgr-admin-upload' },
  });
  expect(res.statusCode).toBe(201);
}

describe('PGR progress review and milestones (BP-04-003)', () => {
  it('opens a review, records evidence, decides a satisfactory outcome, and publishes a milestone', async () => {
    const student = await createPerson('Upgrade', 'Candidate');
    const chair = await createPerson('Panel', 'Chair');
    const enrolmentId = await createEnrolment(student);

    const reviewId = await openReview(enrolmentId, 'upgrade');
    const detail = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/pgr/reviews/${reviewId}`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json<{ statusCode: string; reviewTypeCode: string }>())
      .toMatchObject({ statusCode: 'open', reviewTypeCode: 'upgrade' });

    await addMember(reviewId, chair, 'chair');
    await recordEvidence(reviewId);

    const outcome = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/pgr/reviews/${reviewId}/outcome`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: { outcomeCode: 'satisfactory' },
    });
    expect(outcome.statusCode).toBe(204);

    const afterDecision = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/pgr/reviews/${reviewId}`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(afterDecision.json<{ statusCode: string }>().statusCode).toBe('satisfactory');

    const milestone = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/pgr/reviews/${reviewId}/milestones`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: { milestoneTypeCode: 'upgrade', achievedDate: '2028-06-01' },
    });
    expect(milestone.statusCode).toBe(201);

    const milestones = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/enrolments/${enrolmentId}/research-milestones`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(milestones.statusCode).toBe(200);
    expect(milestones.json<Array<{ milestoneTypeCode: string; publishedAt: string | null }>>())
      .toContainEqual(expect.objectContaining({ milestoneTypeCode: 'upgrade', publishedAt: expect.any(String) }));
  });

  it('rejects an outcome when no evidence has been recorded', async () => {
    const student = await createPerson('NoEvidence', 'Candidate');
    const enrolmentId = await createEnrolment(student);
    const reviewId = await openReview(enrolmentId, 'annual');

    const outcome = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/pgr/reviews/${reviewId}/outcome`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: { outcomeCode: 'satisfactory' },
    });
    expect(outcome.statusCode).toBe(422);
  });

  it('rejects an outcome while a declared conflict remains unresolved', async () => {
    const student = await createPerson('Conflicted', 'Candidate');
    const member = await createPerson('Conflicted', 'Reviewer');
    const enrolmentId = await createEnrolment(student);
    const reviewId = await openReview(enrolmentId, 'annual');
    const memberId = await addMember(reviewId, member, 'independent-reviewer');
    await recordEvidence(reviewId);

    const declare = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/pgr/reviews/members/${memberId}/conflict`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: { conflictTypeCode: 'supervisory' },
    });
    expect(declare.statusCode).toBe(204);

    const outcome = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/pgr/reviews/${reviewId}/outcome`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: { outcomeCode: 'satisfactory' },
    });
    expect(outcome.statusCode).toBe(422);

    const recuse = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/pgr/reviews/members/${memberId}/recuse`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(recuse.statusCode).toBe(204);

    const secondOutcome = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/pgr/reviews/${reviewId}/outcome`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: { outcomeCode: 'satisfactory' },
    });
    expect(secondOutcome.statusCode).toBe(204);
  });

  it('rejects publishing a milestone before the review has been decided', async () => {
    const student = await createPerson('TooEarly', 'Candidate');
    const enrolmentId = await createEnrolment(student);
    const reviewId = await openReview(enrolmentId, 'upgrade');

    const milestone = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/pgr/reviews/${reviewId}/milestones`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: { milestoneTypeCode: 'upgrade', achievedDate: '2028-06-01' },
    });
    expect(milestone.statusCode).toBe(422);
  });

  it('rejects a decision from a role lacking pgr-case:decide', async () => {
    const student = await createPerson('WrongRole', 'Candidate');
    const enrolmentId = await createEnrolment(student);
    const reviewId = await openReview(enrolmentId, 'annual');
    await recordEvidence(reviewId);

    const moduleTutorJwt = await ctx.makeJwt({ roles: ['module-tutor'] });
    const outcome = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/pgr/reviews/${reviewId}/outcome`,
      headers: { authorization: `Bearer ${moduleTutorJwt}` },
      payload: { outcomeCode: 'satisfactory' },
    });
    expect(outcome.statusCode).toBe(403);
  });

  it('does not expose reviews across tenants', async () => {
    const student = await createPerson('Tenant', 'Isolation');
    const enrolmentId = await createEnrolment(student);
    const reviewId = await openReview(enrolmentId, 'annual');

    const secondTenantJwt = await ctx.makeJwt({ tenantId: ctx.secondTenantId });
    const res = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/pgr/reviews/${reviewId}`,
      headers: { authorization: `Bearer ${secondTenantJwt}` },
    });
    expect(res.statusCode).toBe(404);
  });
});
