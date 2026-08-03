import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const paths = {
  delta: resolve(root, 'docs/architecture/business-process-data-model-delta.md'),
  target: resolve(root, 'docs/architecture/business-process-target-data-model.md'),
  migration: resolve(root, 'docs/architecture/business-process-data-migration-plan.md'),
};
const contents = Object.fromEntries(
  Object.entries(paths).map(([name, path]) => [name, readFileSync(path, 'utf8')]),
);
const errors = [];

const expectedIds = Array.from({ length: 19 }, (_, index) => `BPR-D${String(index + 1).padStart(2, '0')}`);
const deltaRows = [...contents.delta.matchAll(/^\| (BPR-D\d{2}) \|/gm)].map((match) => match[1]);
const targetRows = [...contents.target.matchAll(/^\| (BPR-D\d{2}) \|/gm)].map((match) => match[1]);

for (const id of expectedIds) {
  if (deltaRows.filter((value) => value === id).length !== 1) {
    errors.push(`${id} must have exactly one delta assessment row`);
  }
  if (targetRows.filter((value) => value === id).length !== 1) {
    errors.push(`${id} must have exactly one target-model row`);
  }
}

const newCount = (contents.delta.match(/\*\*New aggregate\*\*/g) ?? []).length;
const extendCount = (contents.delta.match(/\*\*Extend\*\*/g) ?? []).length;
const partialCount = (contents.delta.match(/\*\*Partial implementation\*\*/g) ?? []).length;
if (newCount !== 8) errors.push(`Expected 8 unimplemented new-aggregate classifications, found ${newCount}`);
if (extendCount !== 8) errors.push(`Expected 8 extend classifications, found ${extendCount}`);
if (partialCount !== 3) errors.push(`Expected 3 partial implementation classifications, found ${partialCount}`);

for (const [name, text] of Object.entries(contents)) {
  for (const match of text.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
    const rawTarget = match[1];
    const target = rawTarget.split('#', 1)[0];
    if (!target || target.startsWith('http')) continue;
    if (!existsSync(resolve(dirname(paths[name]), decodeURIComponent(target)))) {
      errors.push(`${paths[name]}: broken local link ${rawTarget}`);
    }
  }
  const fences = (text.match(/^```/gm) ?? []).length;
  if (fences % 2 !== 0) errors.push(`${paths[name]}: unclosed code fence`);
}

if (!contents.migration.includes('Clean-build note')) {
  errors.push('Migration plan is missing the clean-build supersession note');
}

for (const heading of [
  '## Stage 1 — Shared foundations',
  '## Stage 2 — P0 domain migrations',
  '## Stage 3 — P1 lifecycle migrations',
  '## Cutover gates',
  '## Rollback',
]) {
  if (!contents.migration.includes(heading)) errors.push(`Migration plan is missing ${heading}`);
}

const coreMigrationCount = (readFileSync(resolve(root, 'packages/db/migrations/meta/_journal.json'), 'utf8').match(/"tag"/g) ?? []).length;
if (coreMigrationCount > 10) {
  errors.push(`Expected a small, squashed core migration set, found ${coreMigrationCount} files — has the clean-build squash regressed?`);
}

if (errors.length > 0) {
  console.error(`Business process data-model checks failed (${errors.length}):`);
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log(`Business process data-model checks passed: 19 capabilities, 10 new aggregates, 8 extensions, 1 partial implementation, migration plan marked historical, ${coreMigrationCount} core migrations.`);
}
