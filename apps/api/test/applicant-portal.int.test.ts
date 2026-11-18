import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startTestApp, type TestApp } from './helpers/test-app.js';

/** Applicant self-service (Phase 5 D-39, ADR-025). */
let ctx: TestApp;
let connector: string;
let officer: string;
let selector: string;
let programmeId: string;
let seq = 0;

beforeAll(async () => {
  ctx = await startTestApp();
  connector = await ctx.makeJwt({ sub: 'applications-connector', roles: ['integration-service'] });
  officer = await ctx.makeJwt({ sub: 'admissions-officer', roles: ['registry-administrator'] });
  selector = await ctx.makeJwt({ sub: 'academic-selector', roles: ['programme-approver'] });
  programmeId = (await call('POST', '/programmes', officer, { code: 'APP-BSC', title: 'BSc Applicant Studies', fheqLevel: 6, creditTotal: 360 })).json<{ programmeId: string }>().programmeId;
}, 120_000);

afterAll(async () => { await ctx?.teardown(); });

const call = (method: 'GET' | 'POST', url: string, as: string, payload?: Record<string, unknown>) =>
  ctx.app.inject({ method, url: `/api/v1${url}`, headers: { authorization: `Bearer ${as}` }, ...(payload ? { payload } : {}) });

interface View {
  applicationId: string; status: string; respondElsewhere: boolean; channelCode: string;
  offer: { offerId: string; statusCode: string; expiresOn: string | null; conditions: Array<{ conditionId: string; statusCode: string; evidence: Array<{ verified: boolean }> }> } | null;
}

/** An application with a conditional offer, and a token for its applicant. */
async function offered(channelCode: 'direct' | 'ucas', opts: { expiresOn?: string } = {}): Promise<{ applicationId: string; personId: string; token: string; sub: string }> {
  const ref = `APP-${channelCode}-${++seq}`;
  const app = (await call('POST', '/applications', connector, {
    channelCode, sourceReference: ref, cycle: '2027', programmeId, intakeCode: '2027-09', modeOfStudyCode: 'full-time',
    applicant: { legalFirstName: `Applicant${seq}`, legalFamilyName: `Portal${ref}` }, payload: { qualifications: ['A-level'] },
  })).json<{ id: string; personId: string; identityMatchCode: string }>();
  expect(app.identityMatchCode).toBe('created');
  await call('POST', `/applications/${app.id}/assessments`, selector, { assessmentTypeCode: 'academic', outcomeCode: 'meets', evidenceRef: 'quals', evidenceVersion: '1', note: 'Strong personal statement' });
  await call('POST', `/applications/${app.id}/recommendation`, officer, { recommendationCode: 'offer', reason: 'Meets published criteria' });
  const decided = await call('POST', `/applications/${app.id}/decision`, selector, {
    decisionCode: 'offer', offer: { offerTypeCode: 'conditional', ...(opts.expiresOn ? { expiresOn: opts.expiresOn } : {}), conditions: [{ conditionTypeCode: 'academic', description: 'AAB at A level', requiredValue: 'AAB' }] },
  });
  expect(decided.statusCode, decided.body).toBe(200);
  const sub = `applicant-${seq}`;
  return { applicationId: app.id, personId: app.personId, sub, token: await ctx.makeJwt({ sub, roles: ['applicant'], srsPersonId: app.personId }) };
}

const ALLOWED_KEYS = ['applicationId', 'channelCode', 'cycle', 'programme', 'intakeCode', 'modeOfStudyCode', 'status', 'respondElsewhere', 'offer', 'confirmation', 'cas', 'withdrawnAt'].sort();

describe('An applicant sees their own applications only', () => {
  it('lists their applications from a fixed set of fields, and nobody else\'s', async () => {
    const a = await offered('direct');
    const b = await offered('direct');
    const list = await call('GET', `/applicants/${a.personId}/applications`, a.token);
    expect(list.statusCode).toBe(200);
    const [view] = list.json<View[]>();
    expect(view).toMatchObject({ applicationId: a.applicationId, status: 'offer-made', respondElsewhere: false });
    // Nothing beyond the allow-list: no assessments, recommendation, routing or identity match.
    expect(Object.keys(view!).sort()).toEqual(ALLOWED_KEYS);
    expect(JSON.stringify(view)).not.toMatch(/Strong personal statement|Meets published criteria|academic-selector|identityMatch/);

    expect((await call('GET', `/applicants/${b.personId}/applications`, a.token)).statusCode).toBe(403);
    expect((await call('GET', `/applicants/${a.personId}/applications/${b.applicationId}`, a.token)).statusCode).toBe(404);
    // Staff who read applications can preview the applicant's view.
    expect((await call('GET', `/applicants/${a.personId}/applications`, officer)).statusCode).toBe(200);
  });

  it('shows nothing while the identity match needs review', async () => {
    const existing = (await call('POST', '/students', officer, { legalFirstName: 'Dana', legalFamilyName: 'Duplicate' })).json<{ personId: string }>().personId;
    const app = (await call('POST', '/applications', connector, {
      channelCode: 'direct', sourceReference: 'APP-REVIEW-1', cycle: '2027', programmeId, intakeCode: '2027-09', modeOfStudyCode: 'full-time',
      applicant: { legalFirstName: 'Dana', legalFamilyName: 'Duplicate' }, payload: {},
    })).json<{ id: string; identityMatchCode: string }>();
    expect(app.identityMatchCode).toBe('needs-review');
    const token = await ctx.makeJwt({ roles: ['applicant'], srsPersonId: existing });
    expect((await call('GET', `/applicants/${existing}/applications`, token)).json<View[]>()).toEqual([]);
    // Once a person confirms the match, the applicant sees it and an applicant account is requested.
    await call('POST', `/applications/${app.id}/identity`, officer, { personId: existing });
    expect((await call('GET', `/applicants/${existing}/applications`, token)).json<View[]>()).toHaveLength(1);
    const iam = await ctx.db.execute(sql`SELECT payload FROM delivery_item WHERE flow_code = 'F-SIS-IAM-01' AND person_id = ${existing}::uuid ORDER BY created_at DESC LIMIT 1`) as unknown as Array<{ payload: Record<string, unknown> }>;
    expect(iam[0]?.payload).toMatchObject({ contractVersion: 2, accountKind: 'applicant', roles: ['applicant'], accessLevel: 'full' });
  });
});

describe('Applicant actions', () => {
  it('accepts a direct offer, recording who replied and where', async () => {
    const a = await offered('direct');
    const view = (await call('GET', `/applicants/${a.personId}/applications/${a.applicationId}`, a.token)).json<View>();
    const res = await call('POST', `/applicants/${a.personId}/offers/${view.offer!.offerId}/response`, a.token, { responseCode: 'accept' });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json<View>().status).toBe('offer-accepted');
    const [offer] = await ctx.db.execute(sql`SELECT responded_by, response_channel_code FROM admissions_offer WHERE id = ${view.offer!.offerId}::uuid`) as unknown as Array<{ responded_by: string; response_channel_code: string }>;
    expect(offer).toMatchObject({ responded_by: a.sub, response_channel_code: 'applicant-portal' });
  });

  it('a UCAS applicant replies in UCAS Hub, not here', async () => {
    const a = await offered('ucas');
    const view = (await call('GET', `/applicants/${a.personId}/applications/${a.applicationId}`, a.token)).json<View>();
    expect(view.respondElsewhere).toBe(true);
    const res = await call('POST', `/applicants/${a.personId}/offers/${view.offer!.offerId}/response`, a.token, { responseCode: 'accept' });
    expect(res.statusCode).toBe(409);
    expect(res.json<{ detail: string }>().detail).toMatch(/UCAS Hub/);
    expect((await call('POST', `/applicants/${a.personId}/applications/${a.applicationId}/withdrawal`, a.token, {})).statusCode).toBe(409);
  });

  it('refuses a reply after the offer has expired', async () => {
    const a = await offered('direct', { expiresOn: '2020-01-01' });
    const view = (await call('GET', `/applicants/${a.personId}/applications/${a.applicationId}`, a.token)).json<View>();
    expect((await call('POST', `/applicants/${a.personId}/offers/${view.offer!.offerId}/response`, a.token, { responseCode: 'accept' })).statusCode).toBe(409);
  });

  it('uploads evidence for a pending condition, unverified and without deciding it', async () => {
    const a = await offered('direct');
    const view = (await call('GET', `/applicants/${a.personId}/applications/${a.applicationId}`, a.token)).json<View>();
    const conditionId = view.offer!.conditions[0]!.conditionId;
    const boundary = '----applicant-evidence';
    const body = [`--${boundary}`, 'Content-Disposition: form-data; name="file"; filename="results.pdf"', 'Content-Type: application/pdf', '', '%PDF-1.4 results', `--${boundary}--`, ''].join('\r\n');
    const res = await ctx.app.inject({
      method: 'POST', url: `/api/v1/applicants/${a.personId}/conditions/${conditionId}/evidence`,
      headers: { authorization: `Bearer ${a.token}`, 'content-type': `multipart/form-data; boundary=${boundary}` }, payload: body,
    });
    expect(res.statusCode, res.body).toBe(201);
    const after = (await call('GET', `/applicants/${a.personId}/applications/${a.applicationId}`, a.token)).json<View>();
    expect(after.offer!.conditions[0]).toMatchObject({ statusCode: 'pending', evidence: [{ verified: false }] });
    const staff = (await call('GET', `/applications/${a.applicationId}`, officer)).json<{ offers: Array<{ conditions: Array<{ evidence: Array<{ provenanceCode: string; verified: boolean; evidenceRef: string }> }> }> }>();
    expect(staff.offers.at(-1)!.conditions[0]!.evidence[0]).toMatchObject({ provenanceCode: 'applicant', verified: false, evidenceRef: expect.stringMatching(/^documents:/) as string });
  });

  it('withdraws, closing the offer and flagging the open CAS case for the CAS officer', async () => {
    const a = await offered('direct');
    const casOfficer = await ctx.makeJwt({ sub: 'cas-officer', roles: ['regulatory-officer'] });
    const cas = await call('POST', `/applications/${a.applicationId}/cas-cases`, casOfficer);
    expect(cas.statusCode, cas.body).toBe(201);
    const casCaseId = cas.json<{ casCaseId: string }>().casCaseId;
    const res = await call('POST', `/applicants/${a.personId}/applications/${a.applicationId}/withdrawal`, a.token, { reasonCode: 'accepted-elsewhere' });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json<View>()).toMatchObject({ status: 'withdrawn', offer: { statusCode: 'withdrawn' } });
    const flagged = (await call('GET', `/regulatory/cas-cases/${casCaseId}`, casOfficer)).json<{ attentionReason: string | null }>();
    expect(flagged.attentionReason).toBe('application-withdrawn');
    expect((await call('POST', `/applicants/${a.personId}/applications/${a.applicationId}/withdrawal`, a.token, {})).statusCode).toBe(409);
  });
});
