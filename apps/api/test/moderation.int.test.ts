import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startTestApp, type TestApp } from './helpers/test-app.js';

interface AssessmentFixture {
  personId: string;
  enrolmentId: string;
  moduleRegistrationId: string;
  assessmentComponentId: string;
}

let ctx: TestApp;
let jwt: string;

beforeAll(async () => {
  ctx = await startTestApp();
  jwt = await ctx.makeJwt();
}, 120_000);

afterAll(async () => {
  await ctx?.teardown();
});

async function createAssessmentFixture(code: string): Promise<AssessmentFixture> {
  const student = await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/students',
    headers: { authorization: `Bearer ${jwt}` },
    payload: { legalFirstName: code, legalFamilyName: 'Moderated' },
  });
  expect(student.statusCode).toBe(201);
  const personId = student.json<{ personId: string }>().personId;

  const enrolment = await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/enrolments',
    headers: { authorization: `Bearer ${jwt}` },
    payload: {
      personId,
      modeOfStudyCode: 'full-time',
      academicYearOfEntry: '2027-28',
      startDate: '2027-09-20',
    },
  });
  expect(enrolment.statusCode).toBe(201);
  const enrolmentId = enrolment.json<{ enrolmentId: string }>().enrolmentId;

  const module = await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/modules',
    headers: { authorization: `Bearer ${jwt}` },
    payload: { code, title: `${code} Module`, creditValue: 20 },
  });
  expect(module.statusCode).toBe(201);
  const moduleId = module.json<{ moduleId: string }>().moduleId;

  const period = await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/academic-periods',
    headers: { authorization: `Bearer ${jwt}` },
    payload: {
      academicYear: '2027-28',
      periodCode: `${code}-SEM1`,
      periodTypeCode: 'semester',
      startDate: '2027-09-20',
      endDate: '2028-01-14',
    },
  });
  expect(period.statusCode).toBe(201);
  const academicPeriodId = period.json<{ academicPeriodId: string }>().academicPeriodId;

  const offering = await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/module-offerings',
    headers: { authorization: `Bearer ${jwt}` },
    payload: { moduleId, academicPeriodId, deliveryModeCode: 'in-person', capacity: 100 },
  });
  expect(offering.statusCode).toBe(201);
  const moduleOfferingId = offering.json<{ moduleOfferingId: string }>().moduleOfferingId;

  const registration = await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/module-registrations',
    headers: { authorization: `Bearer ${jwt}` },
    payload: { enrolmentId, moduleOfferingId, registrationDate: '2027-10-01' },
  });
  expect(registration.statusCode).toBe(201);
  const moduleRegistrationId = registration.json<{ moduleRegistrationId: string }>().moduleRegistrationId;

  const component = await ctx.app.inject({
    method: 'POST',
    url: `/api/v1/module-offerings/${moduleOfferingId}/components`,
    headers: { authorization: `Bearer ${jwt}` },
    payload: { componentTypeCode: 'coursework', title: 'Coursework', weighting: 100 },
  });
  expect(component.statusCode).toBe(201);
  const assessmentComponentId = component.json<{ assessmentComponentId: string }>().assessmentComponentId;

  return { personId, enrolmentId, moduleRegistrationId, assessmentComponentId };
}

async function ingestMark(fixture: AssessmentFixture, rawMark: number): Promise<string> {
  const res = await ctx.app.inject({
    method: 'POST',
    url: `/api/v1/module-registrations/${fixture.moduleRegistrationId}/marks`,
    headers: { authorization: `Bearer ${jwt}` },
    payload: { assessmentComponentId: fixture.assessmentComponentId, rawMark },
  });
  expect(res.statusCode).toBe(201);
  return res.json<{ markId: string }>().markId;
}

describe('Assessment candidate attempt & moderation (BPR-D10)', () => {
  it('creates a mark set with a candidate attempt bridged from the legacy mark, and completes a moderation review', async () => {
    const fixture = await createAssessmentFixture('MOD101');
    const markId = await ingestMark(fixture, 62);

    const markSet = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/moderation/mark-sets',
      headers: { authorization: `Bearer ${jwt}` },
      payload: {
        assessmentComponentId: fixture.assessmentComponentId,
        markIds: [markId],
        sourceQueryHash: 'sha256:markset-001',
      },
    });
    expect(markSet.statusCode).toBe(201);
    const { markSetId } = markSet.json<{ markSetId: string }>();

    const review = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/moderation/reviews',
      headers: { authorization: `Bearer ${jwt}` },
      payload: { markSetId, ruleVersion: '2027-v1' },
    });
    expect(review.statusCode).toBe(201);
    const { reviewId } = review.json<{ reviewId: string }>();

    const sample = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/moderation/reviews/${reviewId}/samples`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: { markId, sampleReasonCode: 'boundary', originalMark: 62 },
    });
    expect(sample.statusCode).toBe(201);

    const complete = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/v1/moderation/reviews/${reviewId}/complete`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: { outcomeCode: 'no-change' },
    });
    expect(complete.statusCode).toBe(204);
  });

  it('404s creating a mark set from an unknown mark', async () => {
    const fixture = await createAssessmentFixture('MOD102');
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/moderation/mark-sets',
      headers: { authorization: `Bearer ${jwt}` },
      payload: {
        assessmentComponentId: fixture.assessmentComponentId,
        markIds: ['00000000-0000-0000-0000-000000000000'],
        sourceQueryHash: 'sha256:markset-002',
      },
    });
    expect(res.statusCode).toBe(404);
  });

  it('lists moderation reviews and can filter to only open ones', async () => {
    const fixture = await createAssessmentFixture('MOD103');
    const markId = await ingestMark(fixture, 55);

    const markSet = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/moderation/mark-sets',
      headers: { authorization: `Bearer ${jwt}` },
      payload: { assessmentComponentId: fixture.assessmentComponentId, markIds: [markId], sourceQueryHash: 'sha256:markset-003' },
    });
    const { markSetId } = markSet.json<{ markSetId: string }>();

    const review = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/moderation/reviews',
      headers: { authorization: `Bearer ${jwt}` },
      payload: { markSetId, ruleVersion: '2027-v2' },
    });
    const { reviewId } = review.json<{ reviewId: string }>();

    const openList = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/moderation/reviews?onlyOpen=true',
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(openList.statusCode).toBe(200);
    expect(openList.json<Array<{ moderationReviewId: string; outcomeCode: string | null }>>())
      .toContainEqual(expect.objectContaining({ moderationReviewId: reviewId, outcomeCode: null }));

    await ctx.app.inject({
      method: 'PATCH',
      url: `/api/v1/moderation/reviews/${reviewId}/complete`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: { outcomeCode: 'adjusted' },
    });

    const afterComplete = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/moderation/reviews?onlyOpen=true',
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(afterComplete.json<Array<{ moderationReviewId: string }>>().map(r => r.moderationReviewId))
      .not.toContain(reviewId);

    const fullList = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/moderation/reviews',
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(fullList.json<Array<{ moderationReviewId: string; outcomeCode: string | null }>>())
      .toContainEqual(expect.objectContaining({ moderationReviewId: reviewId, outcomeCode: 'adjusted' }));
  });
});
