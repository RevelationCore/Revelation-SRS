/**
 * ADR-030 on a core upload route (adjustment outcome documents): the upload
 * is scanned before anything is written; infected is 422, an unavailable
 * scanner 503 with Retry-After, a disabled one 503 without; a document that
 * has not passed is never downloaded (409).
 */
import {
  DocumentScannerUnavailableError,
  type DocumentScanner,
  type ScanVerdict,
} from '@revelation-srs/documents';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { recordApprovedAdjustment } from './helpers/adjustments.js';
import { startTestApp, type TestApp } from './helpers/test-app.js';

let mode: 'clean' | 'infected' | 'timeout' | 'disabled' = 'clean';
let scans = 0;
const scanner: DocumentScanner = {
  engine: 'fake',
  // eslint-disable-next-line @typescript-eslint/require-await
  async scan(): Promise<ScanVerdict> {
    scans++;
    if (mode === 'infected') return { verdict: 'infected', engine: 'fake', databaseVersion: 'fake/1', signature: 'Eicar-Test-Signature' };
    if (mode === 'timeout') throw new DocumentScannerUnavailableError('timeout');
    if (mode === 'disabled') throw new DocumentScannerUnavailableError('disabled');
    return { verdict: 'clean', engine: 'fake', databaseVersion: 'fake/1' };
  },
};

let ctx: TestApp;
let jwt: string;

beforeAll(async () => {
  ctx = await startTestApp({ documentScanner: scanner });
  jwt = await ctx.makeJwt({ roles: ['registry-administrator'] });
}, 120_000);
afterAll(async () => { await ctx?.teardown(); });
beforeEach(() => { mode = 'clean'; scans = 0; });

async function adjustment(code: string): Promise<{ personId: string; adjustmentId: string }> {
  const post = async (url: string, payload: Record<string, unknown>) => {
    const res = await ctx.app.inject({ method: 'POST', url: `/api/v1${url}`, headers: { authorization: `Bearer ${jwt}` }, payload });
    expect(res.statusCode, res.body).toBe(201);
    return res.json<Record<string, string>>();
  };
  const { personId } = await post('/students', { legalFirstName: code, legalFamilyName: 'Scan' });
  const { enrolmentId } = await post('/enrolments', { personId, modeOfStudyCode: 'full-time', academicYearOfEntry: '2027-28', startDate: '2027-09-20' });
  const { adjustmentId } = await recordApprovedAdjustment(ctx, personId!, { enrolmentId, adjustmentTypeCode: 'separate-room', scopeCode: 'exam', validFrom: '2027-09-01T00:00:00.000Z' });
  return { personId: personId!, adjustmentId };
}

function upload(f: { personId: string; adjustmentId: string }, content = 'outcome specification') {
  const boundary = '----scanTestBoundary';
  const body = Buffer.from([`--${boundary}`, 'Content-Disposition: form-data; name="file"; filename="outcome.pdf"', 'Content-Type: application/pdf', '', content, `--${boundary}--`, ''].join('\r\n'));
  return ctx.app.inject({
    method: 'POST', url: `/api/v1/students/${f.personId}/adjustments/${f.adjustmentId}/outcome-document`,
    headers: { authorization: `Bearer ${jwt}`, 'content-type': `multipart/form-data; boundary=${boundary}` }, payload: body,
  });
}
const download = (f: { personId: string; adjustmentId: string }) => ctx.app.inject({
  method: 'GET', url: `/api/v1/students/${f.personId}/adjustments/${f.adjustmentId}/outcome-document`, headers: { authorization: `Bearer ${jwt}` },
});
const rows = (ownerRef: string) => ctx.db.execute(sql`SELECT status_code, content IS NULL AS no_content, scan_signature FROM documents.document WHERE owner_ref = ${ownerRef}`) as unknown as Promise<Array<{ status_code: string; no_content: boolean; scan_signature: string | null }>>;

describe('scanning a core upload (ADR-030)', () => {
  it('stores a clean upload and serves it', async () => {
    const f = await adjustment('SCANOK');
    expect((await upload(f)).statusCode).toBe(201);
    expect(scans).toBe(1);
    expect((await download(f)).body).toBe('outcome specification');
  });

  it('refuses an infected upload with 422, keeping its metadata but not its content', async () => {
    const f = await adjustment('SCANBAD');
    mode = 'infected';
    const res = await upload(f);
    expect(res.statusCode).toBe(422);
    expect(res.json<{ type: string; detail: string }>()).toMatchObject({ type: 'https://srs.example.com/errors/document-rejected' });
    expect(res.body).not.toContain('Eicar');
    expect(await rows(f.adjustmentId)).toEqual([{ status_code: 'infected', no_content: true, scan_signature: 'Eicar-Test-Signature' }]);
    expect((await download(f)).statusCode).toBe(404); // nothing was attached to the adjustment
  });

  it('refuses with 503 and Retry-After when the scanner cannot answer, storing nothing', async () => {
    const f = await adjustment('SCANDOWN');
    mode = 'timeout';
    const res = await upload(f);
    expect(res.statusCode).toBe(503);
    expect(res.headers['retry-after']).toBe('60');
    expect(res.json<{ type: string }>().type).toMatch(/scanner-unavailable$/);
    expect(await rows(f.adjustmentId)).toEqual([]);
  });

  it('refuses with 503 and no Retry-After where uploads are disabled', async () => {
    const f = await adjustment('SCANOFF');
    mode = 'disabled';
    const res = await upload(f);
    expect(res.statusCode).toBe(503);
    expect(res.headers['retry-after']).toBeUndefined();
    expect(res.json<{ detail: string }>().detail).toMatch(/not available in this environment/);
  });

  it('never serves a document that has not passed the check (409)', async () => {
    const f = await adjustment('SCANPEND');
    expect((await upload(f)).statusCode).toBe(201);
    await ctx.db.execute(sql`UPDATE documents.document SET status_code = 'pending-scan' WHERE owner_ref = ${f.adjustmentId}`);
    const res = await download(f);
    expect(res.statusCode).toBe(409);
    expect(res.json<{ type: string }>().type).toMatch(/document-not-available$/);
  });

  it('does not scan an upload the caller may not make', async () => {
    const f = await adjustment('SCANAUTH');
    const other = await adjustment('SCANOTHER');
    const res = await upload({ personId: other.personId, adjustmentId: f.adjustmentId });
    expect(res.statusCode).toBe(404);
    expect(scans).toBe(0);
  });
});
