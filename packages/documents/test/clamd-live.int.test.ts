/**
 * ADR-030 against a real clamd. Skipped unless CLAMD_LIVE_HOST is set, e.g.
 *   docker compose -f infra/compose/docker-compose.yml --profile scanner up -d clamav
 *   CLAMD_LIVE_HOST=127.0.0.1 CLAMD_LIVE_PORT=3310 pnpm --filter @revelation-srs/documents test:int test/clamd-live.int.test.ts
 */
import { describe, expect, it } from 'vitest';

import { ClamdScanner } from '../src/index.js';

const host = process.env['CLAMD_LIVE_HOST'];
const port = Number(process.env['CLAMD_LIVE_PORT'] ?? 3310);

// The EICAR anti-malware test file: harmless, and detected by every scanner.
const EICAR = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';

/** A small, valid PDF made on the spot. */
function pdf(text: string): Buffer {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${text.length + 30} >>\nstream\nBT /F1 12 Tf 72 770 Td (${text}) Tj ET\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((o, i) => { offsets.push(body.length); body += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, 'latin1');
}

describe.skipIf(!host)('real clamd (ADR-030)', () => {
  const scanner = new ClamdScanner({ host: host!, port, timeoutMs: 60_000 });

  it('finds the EICAR test file', async () => {
    const v = await scanner.scan(Buffer.from(EICAR), AbortSignal.timeout(60_000));
    expect(v).toMatchObject({ verdict: 'infected', engine: 'clamav' });
    expect(v.verdict === 'infected' && v.signature).toMatch(/eicar/i);
    expect(v.databaseVersion).toMatch(/^ClamAV 1\.5\./);
  });

  it('passes an ordinary PDF', async () => {
    const v = await scanner.scan(pdf('Disability assessment report'), AbortSignal.timeout(60_000));
    expect(v.verdict).toBe('clean');
  });

  it('scans a file at the upload limit within the time budget', async () => {
    const big = Buffer.concat([pdf('Large scanned letter'), Buffer.alloc(15 * 1024 * 1024 - 2048, 0x20)]);
    const started = Date.now();
    const v = await scanner.scan(big, AbortSignal.timeout(60_000));
    // eslint-disable-next-line no-console
    console.log(`clamd scanned ${(big.length / 1024 / 1024).toFixed(1)} MB in ${Date.now() - started} ms`);
    expect(['clean', 'infected']).toContain(v.verdict);
  }, 90_000);
});
