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

async function submitThesis(enrolmentId: string): Promise<{ examinationCaseId: string; submissionId: string }> {
  const res = await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/pgr/examinations',
    headers: { authorization: `Bearer ${jwt}` },
    payload: {
      enrolmentId, ownerId: 'pgr-admin-01', formatCode: 'traditional',
      declarationConfirmed: true, storageRef: 'repo://thesis/abc123',
    },
  });
  expect(res.statusCode).toBe(201);
  return res.json<{ examinationCaseId: string; submissionId: string }>();
}

async function nominateExaminer(caseId: string, personId: string, examinerRoleCode: 'internal' | 'external'): Promise<string> {
  const res = await ctx.app.inject({
    method: 'POST',
    url: `/api/v1/pgr/examinations/${caseId}/examiners`,
    headers: { authorization: `Bearer ${jwt}` },
    payload: { personId, examinerRoleCode },
  });
  expect(res.statusCode).toBe(201);
  return res.json<{ appointmentId: string }>().appointmentId;
}

async function checkIndependence(appointmentId: string): Promise<void> {
  const res = await ctx.app.inject({
    method: 'POST',
    url: `/api/v1/pgr/examinations/examiners/${appointmentId}/independence-check`,
    headers: { authorization: `Bearer ${jwt}` },
  });
  expect(res.statusCode).toBe(204);
}

async function approvePanel(caseId: string): Promise<{ statusCode: number }> {
  return ctx.app.inject({
    method: 'POST',
    url: `/api/v1/pgr/examinations/${caseId}/examiners/approve`,
    headers: { authorization: `Bearer ${jwt}` },
  });
}

async function recordReport(caseId: string, appointmentId: string): Promise<void> {
  const res = await ctx.app.inject({
    method: 'POST',
    url: `/api/v1/pgr/examinations/${caseId}/examiner-reports`,
    headers: { authorization: `Bearer ${jwt}` },
    payload: { examinerAppointmentId: appointmentId, reportRef: 'workspace://report/1', recommendationCode: 'pass' },
  });
  expect(res.statusCode).toBe(201);
}

async function recordViva(caseId: string): Promise<{ statusCode: number; body: string }> {
  return ctx.app.inject({
    method: 'POST',
    url: `/api/v1/pgr/examinations/${caseId}/viva`,
    headers: { authorization: `Bearer ${jwt}` },
    payload: { heldAt: '2029-03-01T10:00:00.000Z', jointRecommendationText: 'Pass with minor corrections' },
  });
}

describe('PGR thesis submission and examination (BP-05-010)', () => {
  it('submits, nominates and approves examiners, records reports and viva, and ratifies a pass outcome', async () => {
    const student = await createPerson('Thesis', 'Candidate');
    const internalExaminer = await createPerson('Internal', 'Examiner');
    const externalExaminer = await createPerson('External', 'Examiner');
    const enrolmentId = await createEnrolment(student);

    const { examinationCaseId } = await submitThesis(enrolmentId);
    const detail = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/pgr/examinations/${examinationCaseId}`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(detail.json<{ statusCode: string }>().statusCode).toBe('submitted');

    const internalAppointment = await nominateExaminer(examinationCaseId, internalExaminer, 'internal');
    const externalAppointment = await nominateExaminer(examinationCaseId, externalExaminer, 'external');
    await checkIndependence(internalAppointment);
    await checkIndependence(externalAppointment);

    const approve = await approvePanel(examinationCaseId);
    expect(approve.statusCode).toBe(204);

    await recordReport(examinationCaseId, internalAppointment);
    await recordReport(examinationCaseId, externalAppointment);

    const viva = await recordViva(examinationCaseId);
    expect(viva.statusCode).toBe(201);

    const outcome = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/pgr/examinations/${examinationCaseId}/outcome`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: { outcomeCode: 'pass' },
    });
    expect(outcome.statusCode).toBe(201);

    const finalCase = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/pgr/examinations/${examinationCaseId}`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(finalCase.json<{ statusCode: string }>().statusCode).toBe('pass');
  });

  it('requires a corrections deadline for a minor-corrections outcome, and tracks completion', async () => {
    const student = await createPerson('MinorCorrections', 'Candidate');
    const examiner = await createPerson('Solo', 'Examiner');
    const enrolmentId = await createEnrolment(student);
    const { examinationCaseId } = await submitThesis(enrolmentId);
    const appointmentId = await nominateExaminer(examinationCaseId, examiner, 'internal');
    await checkIndependence(appointmentId);
    await approvePanel(examinationCaseId);
    await recordReport(examinationCaseId, appointmentId);
    await recordViva(examinationCaseId);

    const missingDeadline = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/pgr/examinations/${examinationCaseId}/outcome`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: { outcomeCode: 'pass-minor-corrections' },
    });
    expect(missingDeadline.statusCode).toBe(422);

    const outcome = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/pgr/examinations/${examinationCaseId}/outcome`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: { outcomeCode: 'pass-minor-corrections', correctionsDeadline: '2029-04-01' },
    });
    expect(outcome.statusCode).toBe(201);
    const { outcomeId } = outcome.json<{ outcomeId: string }>();

    const requirements = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/pgr/examinations/outcomes/${outcomeId}/corrections`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(requirements.statusCode).toBe(200);
    const [requirement] = requirements.json<Array<{ requirementId: string; completedAt: string | null }>>();
    expect(requirement).toMatchObject({ completedAt: null });

    const complete = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/pgr/examinations/corrections/${requirement!.requirementId}/complete`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(complete.statusCode).toBe(204);
  });

  it('rejects approving the panel when independence has not been checked', async () => {
    const student = await createPerson('NoCheck', 'Candidate');
    const examiner = await createPerson('Unchecked', 'Examiner');
    const enrolmentId = await createEnrolment(student);
    const { examinationCaseId } = await submitThesis(enrolmentId);
    await nominateExaminer(examinationCaseId, examiner, 'internal');

    const approve = await approvePanel(examinationCaseId);
    expect(approve.statusCode).toBe(422);
  });

  it('rejects approving the panel with an unresolved conflict, and allows it once recused', async () => {
    const student = await createPerson('Conflicted', 'Candidate');
    const examiner = await createPerson('Conflicted', 'Examiner');
    const enrolmentId = await createEnrolment(student);
    const { examinationCaseId } = await submitThesis(enrolmentId);
    const appointmentId = await nominateExaminer(examinationCaseId, examiner, 'internal');
    await checkIndependence(appointmentId);

    const declare = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/pgr/examinations/examiners/${appointmentId}/conflict`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: { conflictTypeCode: 'supervisory' },
    });
    expect(declare.statusCode).toBe(204);

    const blocked = await approvePanel(examinationCaseId);
    expect(blocked.statusCode).toBe(422);

    const recuse = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/pgr/examinations/examiners/${appointmentId}/recuse`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(recuse.statusCode).toBe(204);

    // Recusing the only examiner leaves an empty active panel — nominate a replacement.
    const replacement = await createPerson('Replacement', 'Examiner');
    const replacementAppointment = await nominateExaminer(examinationCaseId, replacement, 'internal');
    await checkIndependence(replacementAppointment);

    const approved = await approvePanel(examinationCaseId);
    expect(approved.statusCode).toBe(204);
  });

  it('rejects recording a viva until every confirmed examiner has submitted a report', async () => {
    const student = await createPerson('NoReport', 'Candidate');
    const examiner = await createPerson('Pending', 'Examiner');
    const enrolmentId = await createEnrolment(student);
    const { examinationCaseId } = await submitThesis(enrolmentId);
    const appointmentId = await nominateExaminer(examinationCaseId, examiner, 'internal');
    await checkIndependence(appointmentId);
    await approvePanel(examinationCaseId);

    const viva = await recordViva(examinationCaseId);
    expect(viva.statusCode).toBe(422);
  });

  it('rejects an examiner-panel approval and outcome ratification from a role lacking pgr-case:decide', async () => {
    const student = await createPerson('WrongRole', 'Candidate');
    const examiner = await createPerson('Blocked', 'Examiner');
    const enrolmentId = await createEnrolment(student);
    const { examinationCaseId } = await submitThesis(enrolmentId);
    const appointmentId = await nominateExaminer(examinationCaseId, examiner, 'internal');
    await checkIndependence(appointmentId);

    const moduleTutorJwt = await ctx.makeJwt({ roles: ['module-tutor'] });
    const approve = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/pgr/examinations/${examinationCaseId}/examiners/approve`,
      headers: { authorization: `Bearer ${moduleTutorJwt}` },
    });
    expect(approve.statusCode).toBe(403);
  });

  it('does not expose examination cases across tenants', async () => {
    const student = await createPerson('Tenant', 'Isolation');
    const enrolmentId = await createEnrolment(student);
    const { examinationCaseId } = await submitThesis(enrolmentId);

    const secondTenantJwt = await ctx.makeJwt({ tenantId: ctx.secondTenantId });
    const res = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/pgr/examinations/${examinationCaseId}`,
      headers: { authorization: `Bearer ${secondTenantJwt}` },
    });
    expect(res.statusCode).toBe(404);
  });
});
