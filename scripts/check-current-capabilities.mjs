import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const matrixPath = resolve(root, 'docs/product/current-capabilities.md');
const readmePath = resolve(root, 'README.md');
const docsIndexPath = resolve(root, 'docs/README.md');
const historyPath = resolve(root, 'docs/history.md');
const matrix = readFileSync(matrixPath, 'utf8');
const readme = readFileSync(readmePath, 'utf8');
const docsIndex = readFileSync(docsIndexPath, 'utf8');
const history = readFileSync(historyPath, 'utf8');
const errors = [];

const capabilityRows = [
  ...matrix.matchAll(/^\| ([^|]+) \| \*\*(Implemented baseline|Partial|Approved target|Proposed target|Not assessed)\*\* \|/gm),
];
if (capabilityRows.length !== 20) {
  errors.push(`Expected 20 current-capability rows, found ${capabilityRows.length}`);
}

// 'Proposed target' is intentionally not required here: it described PGR
// lifecycle when that was the only wholly-unstarted capability. PGR moved to
// Partial once BP-03-007/04-003/05-010/06-006 were implemented (2026-08-03),
// and every remaining capability now has at least some implementation, so
// requiring a still-unstarted row would force a dishonest downgrade.
for (const status of ['Implemented baseline', 'Partial']) {
  if (!capabilityRows.some((row) => row[2] === status)) {
    errors.push(`Current-capability matrix has no ${status} capability`);
  }
}

if (/Status.*v1\.0\.0 released|all 11 phases complete/i.test(readme)) {
  errors.push('README still presents the project as v1.0.0/all phases complete');
}
if (!readme.includes('Alpha —')) errors.push('README does not declare alpha convergence status');
if (!readme.includes('Current Capability Matrix')) errors.push('README does not link the status authority');
if (!docsIndex.includes('Current capabilities')) errors.push('Documentation index does not link current capabilities');
if (!history.includes('pre-convergence-2026-07-27')) {
  errors.push('Documentation history does not identify the preservation tag');
}
if (!matrix.includes('Repository typecheck | Pass')) {
  errors.push('Capability matrix does not record the passing repository typecheck');
}
if (!matrix.includes('Clean-clone application bootstrap | **Not verified')) {
  errors.push('Capability matrix does not record unverified clean-clone bootstrap');
}

for (const [path, contents] of [
  [matrixPath, matrix],
  [readmePath, readme],
  [docsIndexPath, docsIndex],
  [historyPath, history],
]) {
  for (const match of contents.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
    const rawTarget = match[1];
    const target = rawTarget.split('#', 1)[0];
    if (!target || target.startsWith('http') || target.startsWith('mailto:')) continue;
    if (!existsSync(resolve(dirname(path), decodeURIComponent(target)))) {
      errors.push(`${path}: broken local link ${rawTarget}`);
    }
  }
}

if (errors.length > 0) {
  console.error(`Current capability checks failed (${errors.length}):`);
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log(`Current capability checks passed: ${capabilityRows.length} capabilities and truthful alpha status.`);
}
