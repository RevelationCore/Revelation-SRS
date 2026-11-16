/**
 * Curriculum publications, recognised credit and rule exceptions (BPR-D05; BP-03-001).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startTestApp, type TestApp } from './helpers/test-app.js';

let ctx: TestApp;
let connectorJwt: string;
let registryJwt: string;
let approverJwt: string;

interface Publication {
  publicationId: string; statusCode: string;
  counts: { added: number; changed: number; closed: number; unchanged: number; rejected: number };
  items: Array<{ objectCode: string; changeTypeCode: string; issue: string | null }>;
}

beforeAll(async () => {
  ctx = await startTestApp();
  connectorJwt = await ctx.makeJwt({ sub: 'curriculum-connector', roles: ['integration-service'] });
  registryJwt = await ctx.makeJwt({ sub: 'registry-1', roles: ['registry-administrator'] });
  approverJwt = await ctx.makeJwt({ sub: 'approver-1', roles: ['programme-approver'] });
}, 120_000);

afterAll(async () => { await ctx?.teardown(); });

const call = (method: 'GET' | 'POST', url: string, jwt: string, payload?: Record<string, unknown>) =>
  ctx.app.inject({ method, url: `/api/v1${url}`, headers: { authorization: `Bearer ${jwt}` }, ...(payload ? { payload } : {}) });

async function publish(body: Record<string, unknown>) {
  return call('POST', '/curriculum-publications', connectorJwt, { sourceSystemCode: 'cm', publicationVersion: '1', effectiveFrom: '2031-08-01', ...body });
}

const moduleByCode = async (code: string) => (await call('GET', '/modules', registryJwt)).json<Array<{ code: string; title: string; creditValue: number }>>()
  .find((m) => m.code === code);

describe('curriculum publication', () => {
  it('receives, classifies and applies a publication atomically, then a change and a closure', async () => {
    const first = await publish({
      sourcePublicationRef: 'PUB-1', approvalRef: 'Senate 2031/04',
      programmes: [{ code: 'CP-BSC', title: 'BSc Curriculum Studies', fheqLevel: 6, creditTotal: 360 }],
      modules: [{ code: 'CP101', title: 'Foundations', creditValue: 20, fheqLevel: 4 }, { code: 'CP102', title: 'Methods', creditValue: 20, fheqLevel: 4 }],
    });
    expect(first.statusCode).toBe(201);
    const received = first.json<Publication>();
    expect(received).toMatchObject({ statusCode: 'validated', counts: { added: 3, changed: 0, closed: 0, unchanged: 0, rejected: 0 } });
    expect(await moduleByCode('CP101')).toBeUndefined();

    const applied = (await call('POST', `/curriculum-publications/${received.publicationId}/application`, registryJwt)).json<Publication>();
    expect(applied.statusCode).toBe('applied');
    expect(await moduleByCode('CP101')).toMatchObject({ title: 'Foundations', creditValue: 20 });

    // Receiving the same publication again is a no-op; different content under the same ref is refused.
    expect((await publish({ sourcePublicationRef: 'PUB-1', approvalRef: 'Senate 2031/04',
      programmes: [{ code: 'CP-BSC', title: 'BSc Curriculum Studies', fheqLevel: 6, creditTotal: 360 }],
      modules: [{ code: 'CP101', title: 'Foundations', creditValue: 20, fheqLevel: 4 }, { code: 'CP102', title: 'Methods', creditValue: 20, fheqLevel: 4 }],
    })).statusCode).toBe(200);
    expect((await publish({ sourcePublicationRef: 'PUB-1', modules: [{ code: 'CP101', title: 'Other' }] })).statusCode).toBe(409);

    const second = (await publish({
      sourcePublicationRef: 'PUB-2', publicationVersion: '2', effectiveFrom: '2032-08-01',
      modules: [{ code: 'CP101', title: 'Foundations of Curriculum', creditValue: 20 }, { code: 'CP102', closed: true }, { code: 'CP103', title: 'Practice', creditValue: 40, fheqLevel: 5 }],
      programmes: [{ code: 'CP-BSC', title: 'BSc Curriculum Studies' }],
    })).json<Publication>();
    expect(second.counts).toEqual({ added: 1, changed: 1, closed: 1, unchanged: 1, rejected: 0 });
    await call('POST', `/curriculum-publications/${second.publicationId}/application`, registryJwt);
    expect(await moduleByCode('CP101')).toMatchObject({ title: 'Foundations of Curriculum' });
    expect(await moduleByCode('CP103')).toMatchObject({ creditValue: 40 });
  });

  it('rejects the whole publication if any item is invalid, and changes nothing', async () => {
    const res = (await publish({
      sourcePublicationRef: 'PUB-BAD',
      modules: [{ code: 'BAD101', title: 'Fine', creditValue: 20 }, { code: 'BAD102', title: 'Broken', creditValue: -5 }, { code: 'BAD101', title: 'Twice' }],
    })).json<Publication>();
    expect(res.statusCode).toBe('rejected');
    expect(res.counts.rejected).toBe(2);
    expect(res.items.filter((i) => i.issue).map((i) => i.issue)).toEqual(expect.arrayContaining([
      'Credit must be a positive whole number', 'module BAD101 appears twice in this publication',
    ]) as unknown);
    expect((await call('POST', `/curriculum-publications/${res.publicationId}/application`, registryJwt)).statusCode).toBe(409);
    expect(await moduleByCode('BAD101')).toBeUndefined();
  });

  it('needs a rationale for a retrospective publication', async () => {
    const res = (await publish({ sourcePublicationRef: 'PUB-RETRO', effectiveFrom: '2020-01-01', modules: [{ code: 'RET101', title: 'Retro', creditValue: 10 }] })).json<Publication>();
    expect(res.statusCode).toBe('rejected');
    expect(res.items.some((i) => i.issue?.includes('correction rationale'))).toBe(true);
  });

  it('refuses to apply over a catalogue that changed after the publication was received', async () => {
    const first = (await publish({ sourcePublicationRef: 'PUB-RACE-0', modules: [{ code: 'RACE101', title: 'Race', creditValue: 10 }] })).json<Publication>();
    await call('POST', `/curriculum-publications/${first.publicationId}/application`, registryJwt);
    const a = (await publish({ sourcePublicationRef: 'PUB-RACE-A', effectiveFrom: '2032-01-01', modules: [{ code: 'RACE101', title: 'Race A' }] })).json<Publication>();
    const b = (await publish({ sourcePublicationRef: 'PUB-RACE-B', effectiveFrom: '2032-02-01', modules: [{ code: 'RACE101', title: 'Race B' }] })).json<Publication>();
    expect((await call('POST', `/curriculum-publications/${a.publicationId}/application`, registryJwt)).statusCode).toBe(200);
    const stale = await call('POST', `/curriculum-publications/${b.publicationId}/application`, registryJwt);
    expect(stale.statusCode).toBe(409);
    expect(await moduleByCode('RACE101')).toMatchObject({ title: 'Race A' });
  });

  it('only the curriculum connector or registry can send publications', async () => {
    const student = await ctx.makeJwt({ roles: ['student'] });
    expect((await call('POST', '/curriculum-publications', student, { sourceSystemCode: 'cm', sourcePublicationRef: 'X', publicationVersion: '1', effectiveFrom: '2031-08-01' })).statusCode).toBe(403);
    expect((await call('POST', '/curriculum-publications/00000000-0000-0000-0000-000000000000/application', connectorJwt)).statusCode).toBe(403);
  });
});

describe('recognised credit and rule exceptions', () => {
  let enrolmentId: string;

  beforeAll(async () => {
    const person = await call('POST', '/students', registryJwt, { legalFirstName: 'Cred', legalFamilyName: 'It' });
    const enrolment = await call('POST', '/enrolments', registryJwt, {
      personId: person.json<{ personId: string }>().personId, modeOfStudyCode: 'full-time', academicYearOfEntry: '2026-27', startDate: '2026-09-21',
    });
    enrolmentId = enrolment.json<{ enrolmentId: string }>().enrolmentId;
  });

  it('recognised credit is approved by someone other than the proposer, and only approved credit counts', async () => {
    const proposed = await call('POST', `/enrolments/${enrolmentId}/recognised-credits`, registryJwt, {
      recognitionTypeCode: 'rpcl', sourceDescription: 'HND Engineering, Other College, 2025', creditValue: 120, fheqLevel: 4, evidenceRef: 'docs:transcript-1',
    });
    expect(proposed.statusCode).toBe(201);
    const id = proposed.json<{ recognisedCreditId: string }>().recognisedCreditId;
    expect((await call('POST', `/recognised-credits/${id}/decision`, registryJwt, { decisionCode: 'approved', reason: 'Self-approval' })).statusCode).toBe(409);
    expect((await call('GET', `/enrolments/${enrolmentId}/recognised-credits`, registryJwt)).json<{ approvedCreditTotal: number }>().approvedCreditTotal).toBe(0);
    expect((await call('POST', `/recognised-credits/${id}/decision`, approverJwt, { decisionCode: 'approved', reason: 'Mapped to year 1' })).statusCode).toBe(200);
    expect((await call('GET', `/enrolments/${enrolmentId}/recognised-credits`, registryJwt)).json<{ approvedCreditTotal: number }>().approvedCreditTotal).toBe(120);
  });

  it('an exemption must name a module', async () => {
    const res = await call('POST', `/enrolments/${enrolmentId}/recognised-credits`, registryJwt, {
      recognitionTypeCode: 'exemption', sourceDescription: 'A-level Maths', creditValue: 20,
    });
    expect(res.statusCode).toBe(422);
  });

  it('a rule exception is approved, in force for its dates, and can be revoked', async () => {
    const proposed = await call('POST', `/enrolments/${enrolmentId}/rule-exceptions`, registryJwt, {
      ruleCode: 'max-credits-per-period', exceptionTypeCode: 'variation', variationValue: { maxCredits: 140 }, description: 'Allow 140 credits in year 2',
      validFrom: '2027-09-01', validTo: '2028-08-31', authorityRef: 'Programme board 2027/09',
    });
    expect(proposed.statusCode).toBe(201);
    const id = proposed.json<{ ruleExceptionId: string }>().ruleExceptionId;
    expect((await call('POST', `/rule-exceptions/${id}/decision`, approverJwt, { decisionCode: 'approved', reason: 'Justified' })).json<{ statusCode: string }>().statusCode).toBe('approved');
    const inForce = await ctx.app.academicExceptionService.inForceExceptions(ctx.tenantId, enrolmentId, '2028-01-01');
    expect(inForce.map((e) => e.id)).toEqual([id]);
    expect(await ctx.app.academicExceptionService.inForceExceptions(ctx.tenantId, enrolmentId, '2028-09-01')).toHaveLength(0);
    expect((await call('POST', `/rule-exceptions/${id}/revocation`, approverJwt, { reason: 'Student changed route' })).json<{ statusCode: string }>().statusCode).toBe('revoked');
  });
});

describe('approver worklist', () => {
  it('lists every pending proposal with its student, and a decided one leaves the list', async () => {
    const person = await call('POST', '/students', registryJwt, { legalFirstName: 'Pending', legalFamilyName: 'Approval' });
    const personId = person.json<{ personId: string }>().personId;
    const enrolmentId = (await call('POST', '/enrolments', registryJwt, {
      personId, modeOfStudyCode: 'full-time', academicYearOfEntry: '2026-27', startDate: '2026-09-21',
    })).json<{ enrolmentId: string }>().enrolmentId;
    const credit = (await call('POST', `/enrolments/${enrolmentId}/recognised-credits`, registryJwt, {
      recognitionTypeCode: 'rpcl', sourceDescription: 'Pending HND', creditValue: 60,
    })).json<{ recognisedCreditId: string }>().recognisedCreditId;
    const exception = (await call('POST', `/enrolments/${enrolmentId}/rule-exceptions`, registryJwt, {
      ruleCode: 'max-credits-per-period', exceptionTypeCode: 'waiver', description: 'Pending waiver', validFrom: '2026-09-01',
    })).json<{ ruleExceptionId: string }>().ruleExceptionId;

    type Pending = { credits: Array<{ recognisedCreditId: string; subject: { personId: string; studentName: string } }>; exceptions: Array<{ ruleExceptionId: string }> };
    const pending = (await call('GET', '/academic-exceptions/pending', approverJwt)).json<Pending>();
    expect(pending.credits.find((c) => c.recognisedCreditId === credit)?.subject).toMatchObject({ personId, studentName: 'Pending Approval' });
    expect(pending.exceptions.map((x) => x.ruleExceptionId)).toContain(exception);

    await call('POST', `/rule-exceptions/${exception}/decision`, approverJwt, { decisionCode: 'approved', reason: 'Justified' });
    const after = (await call('GET', '/academic-exceptions/pending', approverJwt)).json<Pending>();
    expect(after.exceptions.map((x) => x.ruleExceptionId)).not.toContain(exception);
    expect(after.credits.map((c) => c.recognisedCreditId)).toContain(credit);

    // Reading is not approving; another tenant sees none of these.
    const tutorJwt = await ctx.makeJwt({ sub: 'tutor-1', roles: ['personal-tutor'] });
    expect((await call('GET', '/academic-exceptions/pending', tutorJwt)).statusCode).toBe(403);
    const otherTenant = await ctx.makeJwt({ sub: 'approver-2', roles: ['programme-approver'], tenantId: ctx.secondTenantId });
    expect((await call('GET', '/academic-exceptions/pending', otherTenant)).json<Pending>().credits.map((c) => c.recognisedCreditId)).not.toContain(credit);
  });
});

