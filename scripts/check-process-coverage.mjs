// Checks the per-process implementation coverage table in the traceability
// matrix: every academic-journey process page (areas 01-06) has exactly one
// row, each row uses a known coverage value, and the summary counts match the
// rows. Run with: npm run check:process-coverage
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const bpDir = resolve(root, 'docs/business-processes');
const matrix = readFileSync(resolve(bpDir, 'traceability-matrix.md'), 'utf8');
// 'On screen (simulated link)': usable on screen; the external party is reached by manual file or an in-repo simulator (Phase 3 D-14).
const COVERAGE = ['On screen', 'On screen (simulated link)', 'Partly built', 'API only', 'Not built'];
const errors = [];

const processes = readdirSync(bpDir, { withFileTypes: true })
  .filter((d) => d.isDirectory() && /^0[1-6]-/.test(d.name))
  .flatMap((d) => readdirSync(resolve(bpDir, d.name)).filter((f) => /^bp-\d\d-\d\d\d-.*\.md$/.test(f)).map((f) => `${d.name}/${f}`));
const ids = processes.map((p) => p.match(/bp-(\d\d)-(\d\d\d)/).slice(1).join('-')).map((n) => `BP-${n}`);

const section = matrix.split('## Implementation coverage')[1]?.split('\n## ')[0];
if (!section) {
  errors.push('traceability-matrix.md has no "## Implementation coverage" section');
} else {
  const rows = [...section.matchAll(/^\| \[(BP-\d\d-\d\d\d)\]\(([^)]+)\) [^|]+\| ([^|]+?) \|/gm)].map((m) => ({ id: m[1], link: m[2], coverage: m[3].trim() }));
  for (const id of ids) {
    const found = rows.filter((r) => r.id === id);
    if (found.length !== 1) errors.push(`${id}: expected one coverage row, found ${found.length}`);
  }
  for (const row of rows) {
    if (!ids.includes(row.id)) errors.push(`${row.id}: row has no process page in areas 01-06`);
    if (!COVERAGE.includes(row.coverage)) errors.push(`${row.id}: unknown coverage "${row.coverage}" (use ${COVERAGE.join(', ')})`);
    if (!processes.includes(row.link)) errors.push(`${row.id}: link ${row.link} does not match a process page`);
  }
  for (const value of COVERAGE) {
    const stated = section.match(new RegExp(`^\\| ${value.replace(/[()]/g, '\\$&')} \\| (\\d+) \\|$`, 'm'));
    const actual = rows.filter((r) => r.coverage === value).length;
    if (!stated) errors.push(`Summary has no count for "${value}"`);
    else if (Number(stated[1]) !== actual) errors.push(`Summary says ${stated[1]} "${value}", rows say ${actual}`);
  }
  if (errors.length === 0) {
    const counts = COVERAGE.map((v) => `${rows.filter((r) => r.coverage === v).length} ${v.toLowerCase()}`).join(', ');
    console.log(`Process coverage checks passed: ${rows.length} processes (${counts}).`);
  }
}

if (errors.length > 0) {
  console.error(`Process coverage checks failed:\n- ${errors.join('\n- ')}`);
  process.exit(1);
}
