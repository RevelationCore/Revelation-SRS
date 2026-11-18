import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startTestApp, type TestApp } from './helpers/test-app.js';

/** Supervisor, review panel and examiner self-service (Phase 5 D-40, ADR-025). */
let ctx: TestApp;
let staff: string;
let seq = 0;

beforeAll(async () => {
  ctx = await startTestApp();
  staff = await ctx.makeJwt();
}, 120_000);

afterAll(async () => { await ctx?.teardown(); });

const call = (method: 'GET' | 'POST', url: string, as: string, payload?: Record<string, unknown>) =>
  ctx.app.inject({ method, url: `/api/v1${url}`, headers: { authorization: `Bearer ${as}` }, ...(payload ? { payload } : {}) });

async function ok<T>(method: 'GET' | 'POST', url: string, as: string, payload?: Record<string, unknown>): Promise<T> {
  const res = await call(method, url, as, payload);
  expect(res.statusCode, `${method} ${url}: ${res.body}`).toBeLessThan(300);
  return (res.body ? res.json<T>() : undefined) as T;
}

const person = async (first: string) => (await ok<{ personId: string }>('POST', '/students', staff, { legalFirstName: first, legalFamilyName: `Research${++seq}` })).personId;

async function pgrStudent(): Promise<{ enrolmentId: string }> {
  const personId = await person('Candidate');
  return ok('POST', '/enrolments', staff, {
    personId, modeOfStudyCode: 'full-time', academicYearOfEntry: '2027-28', startDate: '2027-09-20', feeBandCode: 'home-postgraduate-research',
  });
}

async function supervise(enrolmentId: string, supervisorId: string): Promise<void> {
  const { supervisionCaseId } = await ok<{ supervisionCaseId: string }>('POST', '/pgr/supervision-cases', staff, { enrolmentId, ownerId: 'pgr-admin', researchArea: 'Cryptography' });
  const { nominationId } = await ok<{ nominationId: string }>('POST', `/pgr/supervision-cases/${supervisionCaseId}/nominations`, staff, { personId: supervisorId, roleDetailCode: 'principal' });
  await ok('POST', `/pgr/supervision-cases/${supervisionCaseId}/nominations/${nominationId}/eligibility-check`, staff);
  await ok('POST', `/pgr/supervision-cases/${supervisionCaseId}/decision`, staff, { decisionTypeCode: 'approve' });
}

/** An examination with two confirmed, independence-checked examiners. */
async function examination(enrolmentId: string, internalId: string, externalId: string) {
  const { examinationCaseId } = await ok<{ examinationCaseId: string }>('POST', '/pgr/examinations', staff, {
    enrolmentId, ownerId: 'pgr-admin', formatCode: 'traditional', declarationConfirmed: true, storageRef: 'repo://thesis/1',
  });
  const internal = (await ok<{ appointmentId: string }>('POST', `/pgr/examinations/${examinationCaseId}/examiners`, staff, { personId: internalId, examinerRoleCode: 'internal' })).appointmentId;
  const external = (await ok<{ appointmentId: string }>('POST', `/pgr/examinations/${examinationCaseId}/examiners`, staff, { personId: externalId, examinerRoleCode: 'external' })).appointmentId;
  return { examinationCaseId, internal, external };
}
const confirm = async (examinationCaseId: string, ...appointmentIds: string[]) => {
  for (const a of appointmentIds) await ok('POST', `/pgr/examinations/examiners/${a}/independence-check`, staff);
  await ok('POST', `/pgr/examinations/${examinationCaseId}/examiners/approve`, staff);
};

const multipart = (fields: Record<string, string>, filename = 'report.pdf') => {
  const boundary = '----research-staff';
  const parts = [
    ...Object.entries(fields).map(([k, v]) => [`--${boundary}`, `Content-Disposition: form-data; name="${k}"`, '', v].join('\r\n')),
    [`--${boundary}`, `Content-Disposition: form-data; name="file"; filename="${filename}"`, 'Content-Type: application/pdf', '', '%PDF-1.4 report'].join('\r\n'),
    `--${boundary}--`, '',
  ];
  return { body: parts.join('\r\n'), contentType: `multipart/form-data; boundary=${boundary}` };
};
const upload = (url: string, token: string, fields: Record<string, string> = {}) => {
  const m = multipart(fields);
  return ctx.app.inject({ method: 'POST', url: `/api/v1${url}`, headers: { authorization: `Bearer ${token}`, 'content-type': m.contentType }, payload: m.body });
};

describe('Supervisors see their own supervisees only', () => {
  it('reads a supervisee through a current assignment, never examiner reports, and loses access when it ends', async () => {
    const supervisorId = await person('Helena');
    const internalId = await person('Elena');
    const externalId = await person('David');
    const { enrolmentId } = await pgrStudent();
    await supervise(enrolmentId, supervisorId);
    const supervisor = await ctx.makeJwt({ sub: `sup-${seq}`, roles: ['research-supervisor'], srsPersonId: supervisorId });

    const exam = await examination(enrolmentId, internalId, externalId);
    await confirm(exam.examinationCaseId, exam.internal, exam.external);
    await ok('POST', `/pgr/examinations/${exam.examinationCaseId}/examiner-reports`, staff, {
      examinerAppointmentId: exam.internal, reportRef: 'workspace://r1', recommendationCode: 'pass', onBehalfReason: 'Emailed',
    });

    const assignments = await ok<{ supervisees: Array<{ enrolmentId: string }> }>('GET', `/research-staff/${supervisorId}/pgr/assignments`, supervisor);
    expect(assignments.supervisees.map((s) => s.enrolmentId)).toEqual([enrolmentId]);
    const view = await call('GET', `/research-staff/${supervisorId}/pgr/supervisees/${enrolmentId}`, supervisor);
    expect(view.statusCode).toBe(200);
    expect(view.json<{ examinations: Array<{ examiners: unknown[] }> }>().examinations[0]!.examiners).toHaveLength(2);
    // No examiner reports or preliminary recommendations reach a supervisor.
    expect(view.body).not.toMatch(/recommendation|workspace:\/\/r1|reportRef/i);

    // The admin PGR workspace is no longer open to supervisors.
    expect((await call('GET', `/pgr/examinations/${exam.examinationCaseId}`, supervisor)).statusCode).toBe(403);
    // Another supervisor's view is not theirs.
    expect((await call('GET', `/research-staff/${internalId}/pgr/assignments`, supervisor)).statusCode).toBe(403);

    // The supervisor's account carries the role (F-SIS-IAM-01 v2).
    const [iam] = await ctx.db.execute(sql`SELECT payload FROM delivery_item WHERE flow_code = 'F-SIS-IAM-01' AND person_id = ${supervisorId}::uuid ORDER BY created_at DESC LIMIT 1`) as unknown as Array<{ payload: Record<string, unknown> }>;
    expect(iam?.payload).toMatchObject({ accountKind: 'external', roles: ['research-supervisor'], accessLevel: 'full' });

    // An end-dated assignment removes access.
    await ctx.db.execute(sql`UPDATE staff_assignment SET valid_from = now() - interval '30 days', valid_to = now() - interval '1 day' WHERE person_id = ${supervisorId}::uuid AND recorded_until IS NULL`);
    expect((await call('GET', `/research-staff/${supervisorId}/pgr/supervisees/${enrolmentId}`, supervisor)).statusCode).toBe(404);
  });

  it('submits a supervisor report as evidence for an open review of their supervisee', async () => {
    const supervisorId = await person('Marcus');
    const { enrolmentId } = await pgrStudent();
    await supervise(enrolmentId, supervisorId);
    const supervisor = await ctx.makeJwt({ sub: `sup-${seq}`, roles: ['research-supervisor'], srsPersonId: supervisorId });
    const { reviewId } = await ok<{ reviewId: string }>('POST', '/pgr/reviews', staff, { enrolmentId, reviewTypeCode: 'annual', ownerId: 'pgr-admin' });
    const res = await upload(`/research-staff/${supervisorId}/pgr/progress-reviews/${reviewId}/supervisor-report`, supervisor);
    expect(res.statusCode, res.body).toBe(201);
    const [ev] = await ctx.db.execute(sql`SELECT evidence_ref, source_system FROM case_evidence_reference WHERE id = ${res.json<{ evidenceId: string }>().evidenceId}::uuid`) as unknown as Array<{ evidence_ref: string; source_system: string }>;
    expect(ev).toMatchObject({ source_system: 'supervisor-report', evidence_ref: expect.stringMatching(/^documents:/) as string });
  });
});

describe('Examiners submit their own reports', () => {
  it('one report per confirmed appointment, with the co-examiner\'s hidden until both have submitted', async () => {
    const { enrolmentId } = await pgrStudent();
    const internalId = await person('Ivy');
    const externalId = await person('Xavier');
    const exam = await examination(enrolmentId, internalId, externalId);
    const internalTok = await ctx.makeJwt({ sub: `ex-i-${seq}`, roles: ['pgr-examiner'], srsPersonId: internalId });
    const externalTok = await ctx.makeJwt({ sub: `ex-x-${seq}`, roles: ['pgr-examiner'], srsPersonId: externalId });

    // Before the panel is confirmed, no report and no thesis.
    expect((await upload(`/research-staff/${internalId}/pgr/examinations/${exam.examinationCaseId}/report`, internalTok, { recommendationCode: 'pass' })).statusCode).toBe(409);
    expect((await call('GET', `/research-staff/${internalId}/pgr/examinations/${exam.examinationCaseId}`, internalTok)).json<{ thesis: unknown }>().thesis).toBeNull();

    await confirm(exam.examinationCaseId, exam.internal, exam.external);
    const first = await upload(`/research-staff/${internalId}/pgr/examinations/${exam.examinationCaseId}/report`, internalTok, { recommendationCode: 'pass' });
    expect(first.statusCode, first.body).toBe(201);
    expect((await upload(`/research-staff/${internalId}/pgr/examinations/${exam.examinationCaseId}/report`, internalTok, { recommendationCode: 'pass' })).statusCode).toBe(409);
    const [report] = await ctx.db.execute(sql`SELECT entry_channel_code, submitted_by FROM examiner_report WHERE id = ${first.json<{ reportId: string }>().reportId}::uuid`) as unknown as Array<{ entry_channel_code: string; submitted_by: string }>;
    expect(report).toMatchObject({ entry_channel_code: 'examiner-portal', submitted_by: `ex-i-${seq}` });

    // The external examiner cannot see the internal's report before submitting their own.
    const before = await ok<{ otherReports: unknown; thesis: unknown; coExaminers: unknown[] }>('GET', `/research-staff/${externalId}/pgr/examinations/${exam.examinationCaseId}`, externalTok);
    expect(before.otherReports).toBeNull();
    expect(before.thesis).not.toBeNull();
    expect(before.coExaminers).toHaveLength(1);
    expect((await upload(`/research-staff/${externalId}/pgr/examinations/${exam.examinationCaseId}/report`, externalTok, { recommendationCode: 'pass-minor-corrections' })).statusCode).toBe(201);
    const after = await ok<{ otherReports: Array<{ recommendationCode: string }> }>('GET', `/research-staff/${externalId}/pgr/examinations/${exam.examinationCaseId}`, externalTok);
    expect(after.otherReports).toEqual([expect.objectContaining({ recommendationCode: 'pass' })]);

    // Staff cannot submit as the examiner through the portal route.
    expect((await upload(`/research-staff/${externalId}/pgr/examinations/${exam.examinationCaseId}/report`, staff)).statusCode).toBe(403);
  });

  it('refuses a report on a recused appointment, and staff entry without a reason', async () => {
    const { enrolmentId } = await pgrStudent();
    const exam = await examination(enrolmentId, await person('Rae'), await person('Sol'));
    await confirm(exam.examinationCaseId, exam.internal, exam.external);
    expect((await call('POST', `/pgr/examinations/${exam.examinationCaseId}/examiner-reports`, staff, {
      examinerAppointmentId: exam.internal, reportRef: 'workspace://r', recommendationCode: 'pass',
    })).statusCode).toBe(400);
    await ok('POST', `/pgr/examinations/examiners/${exam.external}/conflict`, staff, { conflictTypeCode: 'supervisory' });
    await ok('POST', `/pgr/examinations/examiners/${exam.external}/recuse`, staff);
    expect((await call('POST', `/pgr/examinations/${exam.examinationCaseId}/examiner-reports`, staff, {
      examinerAppointmentId: exam.external, reportRef: 'workspace://r', recommendationCode: 'pass', onBehalfReason: 'Emailed',
    })).statusCode).toBe(409);
  });
});
