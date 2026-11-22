/**
 * ADR-030 on the wellbeing evidence route: evidence is scanned before it is
 * stored; infected is 422, an unavailable scanner 503 with Retry-After, and
 * evidence that has not passed is never downloaded (409).
 */
import { DocumentScannerUnavailableError, type DocumentScanner, type ScanVerdict } from '@revelation-srs/documents';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { startTestApp, type TestWellbeingApp } from './helpers/test-db.js';

const PERSON_ID = '22222222-0000-0000-0000-000000000301';
let mode: 'clean' | 'infected' | 'timeout' = 'clean';
const scanner: DocumentScanner = {
  engine: 'fake',
  // eslint-disable-next-line @typescript-eslint/require-await
  async scan(): Promise<ScanVerdict> {
    if (mode === 'infected') return { verdict: 'infected', engine: 'fake', databaseVersion: null, signature: 'Eicar-Test-Signature' };
    if (mode === 'timeout') throw new DocumentScannerUnavailableError('timeout');
    return { verdict: 'clean', engine: 'fake', databaseVersion: null };
  },
};

let ctx: TestWellbeingApp;
let caseId: string;

beforeAll(async () => {
  ctx = await startTestApp({ documentScanner: scanner });
  const dc = await ctx.app.inject({
    method: 'POST', url: '/api/v1/disability-cases', headers: { authorization: `Bearer ${ctx.makeJwt()}` },
    payload: { personId: PERSON_ID, supportTypeCode: 'dsa', dsaAwardRef: 'DSA-SCAN' },
  });
  expect(dc.statusCode, dc.body).toBe(201);
  const { id, wellbeingCaseId } = dc.json<{ id: string; wellbeingCaseId: string }>();
  const ac = await ctx.app.inject({
    method: 'POST', url: '/api/v1/adjustment-cases', headers: { authorization: `Bearer ${ctx.makeJwt()}` },
    payload: { wellbeingCaseId, disabilitySupportCaseId: id, personId: PERSON_ID, adjustmentTypeCode: 'exam-time' },
  });
  expect(ac.statusCode, ac.body).toBe(201);
  caseId = ac.json<{ id: string }>().id;
}, 120_000);
afterAll(async () => { await ctx?.teardown(); });
beforeEach(() => { mode = 'clean'; });

function upload(content = 'a specialist assessor report') {
  const boundary = '----evidenceScanBoundary';
  const body = Buffer.from([
    `--${boundary}`, 'Content-Disposition: form-data; name="evidenceTypeCode"', '', 'assessor-report',
    `--${boundary}`, 'Content-Disposition: form-data; name="file"; filename="report.pdf"', 'Content-Type: application/pdf', '', content,
    `--${boundary}--`, '',
  ].join('\r\n'));
  return ctx.app.inject({
    method: 'POST', url: `/api/v1/adjustment-cases/${caseId}/evidence`,
    headers: { authorization: `Bearer ${ctx.makeJwt()}`, 'content-type': `multipart/form-data; boundary=${boundary}` }, payload: body,
  });
}

describe('scanning wellbeing evidence (ADR-030)', () => {
  it('stores clean evidence and serves it, and refuses it once it is not clean', async () => {
    const res = await upload();
    expect(res.statusCode, res.body).toBe(201);
    const { id, documentId } = res.json<{ id: string; documentId: string }>();
    const get = () => ctx.app.inject({ method: 'GET', url: `/api/v1/adjustment-cases/${caseId}/evidence/${id}`, headers: { authorization: `Bearer ${ctx.makeJwt()}` } });
    expect((await get()).body).toBe('a specialist assessor report');
    await ctx.db.execute(sql`UPDATE documents.document SET status_code = 'pending-scan' WHERE id = ${documentId}::uuid`);
    const refused = await get();
    expect(refused.statusCode).toBe(409);
    expect(refused.json<{ type: string }>().type).toMatch(/document-not-available$/);
  });

  it('refuses infected evidence with 422 and records no evidence row', async () => {
    mode = 'infected';
    const res = await upload('X5O EICAR');
    expect(res.statusCode).toBe(422);
    expect(res.json<{ type: string }>().type).toMatch(/document-rejected$/);
    const evidence = await ctx.db.execute(sql`SELECT count(*)::int AS n FROM wellbeing.adjustment_case_evidence WHERE adjustment_case_id = ${caseId}::uuid`) as unknown as Array<{ n: number }>;
    const infected = await ctx.db.execute(sql`SELECT count(*)::int AS n FROM documents.document WHERE owner_ref = ${caseId} AND status_code = 'infected' AND content IS NULL`) as unknown as Array<{ n: number }>;
    expect(evidence[0]!.n).toBe(1); // only the clean upload above
    expect(infected[0]!.n).toBe(1);
  });

  it('refuses with 503 and Retry-After when the scanner cannot answer', async () => {
    mode = 'timeout';
    const res = await upload();
    expect(res.statusCode).toBe(503);
    expect(res.headers['retry-after']).toBe('60');
  });
});
