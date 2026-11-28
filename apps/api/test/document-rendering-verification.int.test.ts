/**
 * Rendering, signing and public verification of award documents (Phase 3 D-20, D-21).
 */
import { createHash, createHmac, randomUUID } from 'node:crypto';

import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DEV_PUBLIC_VERIFY_IP_KEY } from '../src/config.js';
import { verifyDetached } from '../src/platform/progression/document-signer.js';

import { startTestApp, type TestApp } from './helpers/test-app.js';

let ctx: TestApp;
let registryJwt: string;
let tenantCode: string;

const call = (method: 'GET' | 'POST', url: string, as: string, payload?: Record<string, unknown>) =>
  ctx.app.inject({ method, url: `/api/v1${url}`, headers: { authorization: `Bearer ${as}` }, ...(payload ? { payload } : {}) });

interface Issue {
  documentIssueId: string; verificationCode: string; contentHash: string; personId: string;
  rendered: { documentId: string; templateCode: string; templateVersion: string; pdfSha256: string; signingKeyId: string } | null;
}
interface Verification { outcomeCode: string; document: { holderName: string } | null; signature?: { status: string; keyId: string | null }; issuer?: string }

beforeAll(async () => {
  ctx = await startTestApp();
  registryJwt = await ctx.makeJwt({ sub: 'docs-registry', roles: ['registry-administrator'] });
  tenantCode = ((await ctx.db.execute(sql`SELECT code FROM tenant WHERE id = ${ctx.tenantId}`)) as unknown as Array<{ code: string }>)[0]!.code;
}, 120_000);

afterAll(async () => { await ctx?.teardown(); });

async function graduate(name: string): Promise<{ personId: string; awardId: string; jwt: string }> {
  const personId = (await call('POST', '/students', registryJwt, { legalFirstName: name, legalFamilyName: 'Signed', dateOfBirth: '2001-02-03' })).json<{ personId: string }>().personId;
  const enrolmentId = (await call('POST', '/enrolments', registryJwt, { personId, modeOfStudyCode: 'full-time', academicYearOfEntry: '2023-24', startDate: '2023-09-25' })).json<{ enrolmentId: string }>().enrolmentId;
  const awardId = randomUUID();
  await ctx.db.execute(sql`
    INSERT INTO award (version_id, id, tenant_id, enrolment_id, person_id, source_case_id, qualification_code, classification_code, award_date, actor_id, valid_from, hear_document)
    VALUES (${randomUUID()}, ${awardId}, ${ctx.tenantId}, ${enrolmentId}, ${personId}, ${randomUUID()}, 'BSc', 'first', '2026-07-15', 'test', now(),
      ${JSON.stringify({ moduleResults: [{ moduleCode: 'CS101', moduleTitle: 'Programming', creditValue: 20, academicYear: '2023-24', aggregateMark: 72, resultCode: 'pass' }] })}::jsonb)`);
  return { personId, awardId, jwt: await ctx.makeJwt({ sub: `student-${name}`, roles: ['student'], srsPersonId: personId }) };
}

const publicGet = (url: string) => ctx.app.inject({ method: 'GET', url: `/public/v1${url}` });

describe('rendering and signing (D-20)', () => {
  it('stores a PDF with the issue, signs it, and the signature checks against the published key', async () => {
    const g = await graduate('Pia');
    const issued = await call('POST', `/awards/${g.awardId}/documents`, registryJwt, { documentTypeCode: 'transcript', channelCode: 'digital' });
    expect(issued.statusCode).toBe(201);
    const issue = issued.json<Issue>();
    expect(issue.rendered).toMatchObject({ templateCode: 'transcript', templateVersion: 'builtin-1' });
    expect(issue.verificationCode).toMatch(/^[23456789ABCDEFGHJKMNPQRSTVWXYZ]{12}$/);

    // The student downloads their own PDF; another student cannot.
    const pdf = await ctx.app.inject({ method: 'GET', url: `/api/v1/document-issues/${issue.documentIssueId}/pdf`, headers: { authorization: `Bearer ${g.jwt}` } });
    expect(pdf.statusCode).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect(pdf.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
    expect(createHash('sha256').update(pdf.rawPayload).digest('hex')).toBe(issue.rendered!.pdfSha256);
    const other = await graduate('Quin');
    expect((await ctx.app.inject({ method: 'GET', url: `/api/v1/document-issues/${issue.documentIssueId}/pdf`, headers: { authorization: `Bearer ${other.jwt}` } })).statusCode).toBe(403);

    // Offline check: the JWS verifies against the key in the public JWKS.
    const jwks = (await publicGet(`/keys/${tenantCode}`)).json<{ keys: Array<{ kid: string; kty: string; crv: string; x: string; y: string }> }>();
    const jwk = jwks.keys.find((k) => k.kid === issue.rendered!.signingKeyId)!;
    expect(jwk).toMatchObject({ kty: 'EC', crv: 'P-256' });
    const [row] = (await ctx.db.execute(sql`SELECT signature_jws, public_key_pem FROM document_issue i JOIN document_signing_key k ON k.key_id = i.signing_key_id WHERE i.id = ${issue.documentIssueId}`)) as unknown as Array<{ signature_jws: string; public_key_pem: string }>;
    const payload = { issueId: issue.documentIssueId, contentHash: issue.contentHash, pdfSha256: issue.rendered!.pdfSha256, verificationCode: issue.verificationCode };
    expect(verifyDetached(row!.signature_jws, payload, row!.public_key_pem)).toBe(true);
    expect(verifyDetached(row!.signature_jws, { ...payload, contentHash: 'tampered' }, row!.public_key_pem)).toBe(false);
  });
});

describe('verification without an account (D-21)', () => {
  it('checks by code and by file, discloses only what the document states, and logs a hashed IP', async () => {
    const g = await graduate('Rue');
    const issue = (await call('POST', `/awards/${g.awardId}/documents`, registryJwt, { documentTypeCode: 'certificate', channelCode: 'digital' })).json<Issue>();

    const byCode = await publicGet(`/verify/${tenantCode}/${issue.verificationCode.toLowerCase()}`);
    expect(byCode.statusCode).toBe(200);
    expect(byCode.json<Verification>()).toMatchObject({ outcomeCode: 'valid', document: { holderName: 'Rue Signed' }, signature: { status: 'valid' } });
    expect(byCode.json<Verification>().issuer).toBeTruthy();
    expect((await publicGet(`/verify/${tenantCode}/NOTAREALCODE1`)).json()).toEqual({ outcomeCode: 'not-found', document: null });
    expect((await publicGet(`/verify/no-such-institution/${issue.verificationCode}`)).statusCode).toBe(404);

    const pdf = (await ctx.app.inject({ method: 'GET', url: `/api/v1/document-issues/${issue.documentIssueId}/pdf`, headers: { authorization: `Bearer ${registryJwt}` } })).rawPayload;
    const byFile = await ctx.app.inject({ method: 'POST', url: `/public/v1/verify/${tenantCode}/file`, headers: { 'content-type': 'application/pdf' }, payload: pdf });
    expect(byFile.json<Verification>()).toMatchObject({ outcomeCode: 'valid', signature: { status: 'valid' } });
    const altered = Buffer.concat([pdf, Buffer.from('%tampered')]);
    expect((await ctx.app.inject({ method: 'POST', url: `/public/v1/verify/${tenantCode}/file`, headers: { 'content-type': 'application/pdf' }, payload: altered })).json<Verification>().outcomeCode).toBe('not-found');

    const logged = (await ctx.db.execute(sql`SELECT requester_ip_hash, method_code FROM document_verification WHERE requested_by = 'public' AND document_issue_id = ${issue.documentIssueId}`)) as unknown as Array<{ requester_ip_hash: string; method_code: string }>;
    expect(logged.map((l) => l.method_code).sort()).toEqual(['code', 'file']);
    // An HMAC under the configured key (BL-184), not a hash with a published salt.
    const expected = createHmac('sha256', DEV_PUBLIC_VERIFY_IP_KEY).update('127.0.0.1').digest('hex');
    expect(logged.map((l) => l.requester_ip_hash)).toEqual([expected, expected]);
    expect(logged[0]?.requester_ip_hash).not.toBe(createHash('sha256').update('srs-public-verify:127.0.0.1').digest('hex'));
  });

  it('the institution can withhold the facts; a staff lookup by name and date of birth needs consent', async () => {
    const g = await graduate('Sol');
    const issue = (await call('POST', `/awards/${g.awardId}/documents`, registryJwt, { documentTypeCode: 'certificate', channelCode: 'digital' })).json<Issue>();
    await ctx.db.execute(sql`UPDATE tenant SET configuration = configuration || '{"documents":{"publicVerification":{"discloseFacts":false}}}'::jsonb WHERE id = ${ctx.tenantId}`);
    expect((await publicGet(`/verify/${tenantCode}/${issue.verificationCode}`)).json<Verification>()).toMatchObject({ outcomeCode: 'valid', document: null });
    await ctx.db.execute(sql`UPDATE tenant SET configuration = configuration - 'documents' WHERE id = ${ctx.tenantId}`);

    expect((await call('POST', '/document-verifications/lookup', registryJwt, { legalFamilyName: 'Signed', dateOfBirth: '2001-02-03', consentEvidenceRef: '' })).statusCode).toBe(400);
    const found = await call('POST', '/document-verifications/lookup', registryJwt, { legalFamilyName: 'signed', dateOfBirth: '2001-02-03', consentEvidenceRef: 'HEDD consent 4471' });
    expect(found.json<Verification[]>().some((v) => v.document?.holderName === 'Sol Signed')).toBe(true);
    const consent = (await ctx.db.execute(sql`SELECT count(*)::int AS n FROM document_verification WHERE method_code = 'staff-lookup' AND consent_evidence_ref = 'HEDD consent 4471'`)) as unknown as Array<{ n: number }>;
    expect(consent[0]!.n).toBeGreaterThan(0);
  });
});

describe('signing keys (D-20)', () => {
  it('a compromised key makes verification report the withdrawal and lists the issues to re-issue', async () => {
    const g = await graduate('Tam');
    const issue = (await call('POST', `/awards/${g.awardId}/documents`, registryJwt, { documentTypeCode: 'certificate', channelCode: 'digital' })).json<Issue>();
    const adminJwt = await ctx.makeJwt({ sub: 'docs-admin', roles: ['tenant-administrator'] });
    expect((await call('GET', '/document-signing-keys', registryJwt)).statusCode).toBe(403);
    const marked = await call('POST', `/document-signing-keys/${issue.rendered!.signingKeyId}/status`, adminJwt, { statusCode: 'compromised' });
    expect(marked.json<{ affectedIssueIds: string[] }>().affectedIssueIds).toContain(issue.documentIssueId);
    expect((await publicGet(`/verify/${tenantCode}/${issue.verificationCode}`)).json<Verification>().signature).toMatchObject({ status: 'key-withdrawn' });
    expect((await publicGet(`/keys/${tenantCode}`)).json<{ keys: Array<{ kid: string }> }>().keys.map((k) => k.kid)).not.toContain(issue.rendered!.signingKeyId);
  });
});
