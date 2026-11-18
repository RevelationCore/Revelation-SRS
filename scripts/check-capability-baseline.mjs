#!/usr/bin/env node
// Phase 5 D-46: an academic-journey capability rated Implemented baseline
// must name its principal-path tests in the capability matrix, and every
// test file it names must exist.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const matrixPath = join(root, 'docs/product/current-capabilities.md');
const matrix = readFileSync(matrixPath, 'utf8');

// The capabilities in the academic-journey areas (business-process areas 01 to 06).
const JOURNEY = [
  'admissions-and-applicant-conversion', 'cas-and-student-sponsor-compliance', 'initial-annual-registration-and-status',
  'curriculum-and-catalogue', 'module-selection-and-registration', 'attendance-and-academic-engagement',
  'reasonable-adjustments-and-exceptional-circumstances', 'assessment-marks-and-module-results', 'exam-boards-and-ratification',
  'post-ratification-correction', 'progression-awards-and-hear', 'pgr-lifecycle',
];

const errors = [];
if (!/^\| ID \| Capability \| Status \|.*\| Principal-path tests \|$/m.test(matrix)) errors.push('The capability matrix has no "Principal-path tests" column');
for (const id of JOURNEY) {
  const row = matrix.split('\n').find((l) => l.startsWith(`| \`${id}\` |`));
  if (!row) { errors.push(`${id}: no row in the capability matrix`); continue; }
  const cells = row.split(' | ');
  if (!cells[2]?.includes('Implemented baseline')) continue;
  const tests = [...(cells.at(-1) ?? '').matchAll(/`([^`]+)`/g)].map((m) => m[1]);
  if (tests.length === 0) { errors.push(`${id}: rated Implemented baseline but names no principal-path tests`); continue; }
  if (!tests.some((t) => t.endsWith('.int.test.ts'))) errors.push(`${id}: no integration test among its principal-path tests`);
  if (!tests.some((t) => t.startsWith('e2e/') && t.endsWith('.spec.ts'))) errors.push(`${id}: no Playwright test among its principal-path tests`);
  for (const t of tests) if (!existsSync(join(root, t))) errors.push(`${id}: principal-path test ${t} does not exist`);
}

if (errors.length > 0) {
  console.error('Capability baseline check failed:');
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log(`check:capability-baseline ok: ${JOURNEY.length} journey capabilities checked`);
