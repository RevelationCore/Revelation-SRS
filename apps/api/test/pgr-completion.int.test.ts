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

/** Drives an examination case through to a ratified outcome, returning the case id. */
async function ratifyExamination(enrolmentId: string, outcomeCode: string, correctionsDeadline?: string): Promise<string> {
  const submit = await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/pgr/examinations',
    headers: { authorization: `Bearer ${jwt}` },
    payload: {
      enrolmentId, ownerId: 'pgr-admin-01', formatCode: 'traditional',
      declarationConfirmed: true, storageRef: 'repo://thesis/xyz',
    },
  });
  const { examinationCaseId } = submit.json<{ examinationCaseId: string }>();

  const examinerPersonId = await createPerson('Sole', `Examiner-${examinationCaseId.slice(0, 6)}`);
  const nominate = await ctx.app.inject({
    method: 'POST',
    url: `/api/v1/pgr/examinations/${examinationCaseId}/examiners`,
    headers: { authorization: `Bearer ${jwt}` },
    payload: { personId: examinerPersonId, examinerRoleCode: 'internal' },
  });
  const { appointmentId } = nominate.json<{ appointmentId: string }>();

  await ctx.app.inject({
    method: 'POST',
    url: `/api/v1/pgr/examinations/examiners/${appointmentId}/independence-check`,
    headers: { authorization: `Bearer ${jwt}` },
  });
  await ctx.app.inject({
    method: 'POST',
    url: `/api/v1/pgr/examinations/${examinationCaseId}/examiners/approve`,
    headers: { authorization: `Bearer ${jwt}` },
  });
  await ctx.app.inject({
    method: 'POST',
    url: `/api/v1/pgr/examinations/${examinationCaseId}/examiner-reports`,
    headers: { authorization: `Bearer ${jwt}` },
    payload: { examinerAppointmentId: appointmentId, reportRef: 'workspace://report/1' },
  });
  await ctx.app.inject({
    method: 'POST',
    url: `/api/v1/pgr/examinations/${examinationCaseId}/viva`,
    headers: { authorization: `Bearer ${jwt}` },
    payload: { heldAt: '2029-03-01T10:00:00.000Z', jointRecommendationText: 'Recommend outcome' },
  });
  const outcome = await ctx.app.inject({
    method: 'POST',
    url: `/api/v1/pgr/examinations/${examinationCaseId}/outcome`,
    headers: { authorization: `Bearer ${jwt}` },
    payload: { outcomeCode, ...(correctionsDeadline ? { correctionsDeadline } : {}) },
  });
  expect(outcome.statusCode).toBe(201);

  return examinationCaseId;
}

describe('PGR completion and research award conferral (BP-06-006)', () => {
  it('opens completion, records deposit, completes, and confers a research award closing supervision', async () => {
    const student = await createPerson('Complete', 'Candidate');
    const supervisor = await createPerson('Final', 'Supervisor');
    const enrolmentId = await createEnrolment(student);

    // Establish and approve a supervision team so we can verify it gets closed on award.
    const supervisionCase = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/pgr/supervision-cases',
      headers: { authorization: `Bearer ${jwt}` },
      payload: { enrolmentId, ownerId: 'pgr-admin-01' },
    });
    const { supervisionCaseId } = supervisionCase.json<{ supervisionCaseId: string }>();
    const nomination = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/pgr/supervision-cases/${supervisionCaseId}/nominations`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: { personId: supervisor, roleDetailCode: 'principal' },
    });
    const { nominationId } = nomination.json<{ nominationId: string }>();
    await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/pgr/supervision-cases/${supervisionCaseId}/nominations/${nominationId}/eligibility-check`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/pgr/supervision-cases/${supervisionCaseId}/decision`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: { decisionTypeCode: 'approve' },
    });

    const examinationCaseId = await ratifyExamination(enrolmentId, 'pass');

    const openCompletion = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/pgr/completions',
      headers: { authorization: `Bearer ${jwt}` },
      payload: { examinationCaseId, ownerId: 'pgr-admin-01' },
    });
    expect(openCompletion.statusCode).toBe(201);
    const { completionCaseId } = openCompletion.json<{ completionCaseId: string }>();

    const missingDeposit = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/pgr/completions/${completionCaseId}/complete`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(missingDeposit.statusCode).toBe(422);

    const deposit = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/pgr/completions/${completionCaseId}/deposit`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: { depositRef: 'repo://final/xyz', ipDeclarationConfirmed: true },
    });
    expect(deposit.statusCode).toBe(201);

    const complete = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/pgr/completions/${completionCaseId}/complete`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(complete.statusCode).toBe(204);

    const confer = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/pgr/completions/${completionCaseId}/award`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: { qualificationCode: 'PhD', awardDate: '2029-07-15' },
    });
    expect(confer.statusCode).toBe(201);

    const assignments = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/enrolments/${enrolmentId}/supervision`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(assignments.json<unknown[]>()).toEqual([]);

    const duplicateAward = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/pgr/completions/${completionCaseId}/award`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: { qualificationCode: 'PhD', awardDate: '2029-07-15' },
    });
    expect(duplicateAward.statusCode).toBe(422);
  });

  it('rejects opening completion when the examination outcome is fail', async () => {
    const student = await createPerson('Failed', 'Candidate');
    const enrolmentId = await createEnrolment(student);
    const examinationCaseId = await ratifyExamination(enrolmentId, 'fail');

    const openCompletion = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/pgr/completions',
      headers: { authorization: `Bearer ${jwt}` },
      payload: { examinationCaseId, ownerId: 'pgr-admin-01' },
    });
    expect(openCompletion.statusCode).toBe(422);
  });

  it('rejects opening completion when required corrections are not yet complete', async () => {
    const student = await createPerson('Uncorrected', 'Candidate');
    const enrolmentId = await createEnrolment(student);
    const examinationCaseId = await ratifyExamination(enrolmentId, 'pass-minor-corrections', '2029-08-01');

    const openCompletion = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/pgr/completions',
      headers: { authorization: `Bearer ${jwt}` },
      payload: { examinationCaseId, ownerId: 'pgr-admin-01' },
    });
    expect(openCompletion.statusCode).toBe(422);
  });

  it('rejects conferring an award before completion has been recorded', async () => {
    const student = await createPerson('TooEarly', 'Candidate');
    const enrolmentId = await createEnrolment(student);
    const examinationCaseId = await ratifyExamination(enrolmentId, 'pass');

    const openCompletion = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/pgr/completions',
      headers: { authorization: `Bearer ${jwt}` },
      payload: { examinationCaseId, ownerId: 'pgr-admin-01' },
    });
    const { completionCaseId } = openCompletion.json<{ completionCaseId: string }>();

    const confer = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/pgr/completions/${completionCaseId}/award`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: { qualificationCode: 'PhD', awardDate: '2029-07-15' },
    });
    expect(confer.statusCode).toBe(422);
  });

  it('rejects a research-award conferral from a role lacking award:confer:research', async () => {
    const student = await createPerson('WrongRole', 'Candidate');
    const enrolmentId = await createEnrolment(student);
    const examinationCaseId = await ratifyExamination(enrolmentId, 'pass');

    const openCompletion = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/pgr/completions',
      headers: { authorization: `Bearer ${jwt}` },
      payload: { examinationCaseId, ownerId: 'pgr-admin-01' },
    });
    const { completionCaseId } = openCompletion.json<{ completionCaseId: string }>();
    await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/pgr/completions/${completionCaseId}/deposit`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: { depositRef: 'repo://final/xyz', ipDeclarationConfirmed: true },
    });
    await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/pgr/completions/${completionCaseId}/complete`,
      headers: { authorization: `Bearer ${jwt}` },
    });

    const moduleTutorJwt = await ctx.makeJwt({ roles: ['module-tutor'] });
    const confer = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/pgr/completions/${completionCaseId}/award`,
      headers: { authorization: `Bearer ${moduleTutorJwt}` },
      payload: { qualificationCode: 'PhD', awardDate: '2029-07-15' },
    });
    expect(confer.statusCode).toBe(403);
  });

  it('does not expose completion cases across tenants', async () => {
    const student = await createPerson('Tenant', 'Isolation');
    const enrolmentId = await createEnrolment(student);
    const examinationCaseId = await ratifyExamination(enrolmentId, 'pass');

    const openCompletion = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/pgr/completions',
      headers: { authorization: `Bearer ${jwt}` },
      payload: { examinationCaseId, ownerId: 'pgr-admin-01' },
    });
    const { completionCaseId } = openCompletion.json<{ completionCaseId: string }>();

    const secondTenantJwt = await ctx.makeJwt({ tenantId: ctx.secondTenantId });
    const res = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/pgr/completions/${completionCaseId}`,
      headers: { authorization: `Bearer ${secondTenantJwt}` },
    });
    expect(res.statusCode).toBe(404);
  });
});
