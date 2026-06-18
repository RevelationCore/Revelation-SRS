/**
 * Checks total gzipped JS bundle sizes against Stage 0 performance budgets.
 * Budgets: portal ≤ 150 kB gzipped, admin ≤ 250 kB gzipped.
 */
import { createReadStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { createGzip } from 'node:zlib';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Writable } from 'node:stream';

const BUDGETS = [
  { app: 'portal', dir: 'apps/portal/dist/assets', maxKb: 150 },
  { app: 'admin',  dir: 'apps/admin/dist/assets',  maxKb: 250 },
];

async function gzippedSize(filePath) {
  let bytes = 0;
  const counter = new Writable({
    write(chunk, _enc, cb) { bytes += chunk.length; cb(); },
  });
  await pipeline(createReadStream(filePath), createGzip(), counter);
  return bytes;
}

async function totalJsSize(dir) {
  let files;
  try {
    files = await readdir(dir);
  } catch {
    throw new Error(`Build output not found: ${dir} — run "pnpm build" first`);
  }
  const jsFiles = files.filter(f => f.endsWith('.js'));
  let total = 0;
  for (const f of jsFiles) {
    const p = join(dir, f);
    const s = await stat(p);
    if (s.isFile()) total += await gzippedSize(p);
  }
  return total;
}

let failed = false;

for (const { app, dir, maxKb } of BUDGETS) {
  const bytes = await totalJsSize(dir);
  const kb    = (bytes / 1024).toFixed(1);
  const limit = maxKb;
  const ok    = bytes <= maxKb * 1024;
  const mark  = ok ? '✓' : '✗';
  console.log(`${mark}  ${app}: ${kb} kB gzipped  (budget: ${limit} kB)`);
  if (!ok) failed = true;
}

if (failed) {
  console.error('\nBundle size budget exceeded — see output above.');
  process.exit(1);
}
