/**
 * Checks the JavaScript each app loads at start-up against the Stage 0
 * performance budgets: portal ≤ 150 kB gzipped, admin ≤ 250 kB gzipped.
 *
 * Start-up JavaScript is the entry script plus every chunk index.html
 * preloads: what a browser downloads before the first page renders. Pages
 * loaded on demand (lazy routes) are not in it, so splitting a page out is
 * rewarded rather than penalised. The total of all chunks is reported for
 * information; it grows with every feature and with every split (each chunk
 * compresses separately), so it is not a useful gate.
 */
import { createReadStream, readFileSync } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { createGzip } from 'node:zlib';
import { join, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Writable } from 'node:stream';

const BUDGETS = [
  { app: 'portal', dist: 'apps/portal/dist', maxKb: 150 },
  { app: 'admin',  dist: 'apps/admin/dist',  maxKb: 250 },
];

async function gzippedSize(filePath) {
  let bytes = 0;
  const counter = new Writable({
    write(chunk, _enc, cb) { bytes += chunk.length; cb(); },
  });
  await pipeline(createReadStream(filePath), createGzip(), counter);
  return bytes;
}

/** The entry script and modulepreloaded chunks named in index.html. */
function startupScripts(dist) {
  let html;
  try {
    html = readFileSync(join(dist, 'index.html'), 'utf8');
  } catch {
    throw new Error(`Build output not found: ${dist} — run "pnpm build" first`);
  }
  const refs = [
    ...html.matchAll(/<script[^>]+type="module"[^>]+src="([^"]+\.js)"/g),
    ...html.matchAll(/<link[^>]+rel="modulepreload"[^>]+href="([^"]+\.js)"/g),
  ].map((m) => m[1].replace(/^\//, ''));
  if (refs.length === 0) throw new Error(`${dist}/index.html names no module script`);
  return [...new Set(refs)].map((ref) => resolve(dist, ref));
}

async function totalJsSize(dir) {
  const files = (await readdir(dir)).filter((f) => f.endsWith('.js'));
  let total = 0;
  for (const f of files) {
    const p = join(dir, f);
    if ((await stat(p)).isFile()) total += await gzippedSize(p);
  }
  return total;
}

let failed = false;

for (const { app, dist, maxKb } of BUDGETS) {
  let startup = 0;
  for (const file of startupScripts(dist)) startup += await gzippedSize(file);
  const total = await totalJsSize(join(dist, 'assets'));
  const ok = startup <= maxKb * 1024;
  console.log(`${ok ? '✓' : '✗'}  ${app}: ${(startup / 1024).toFixed(1)} kB gzipped at start-up (budget: ${maxKb} kB); all chunks ${(total / 1024).toFixed(1)} kB`);
  if (!ok) failed = true;
}

if (failed) {
  console.error('\nStart-up JavaScript exceeds its budget — see output above.');
  process.exit(1);
}
