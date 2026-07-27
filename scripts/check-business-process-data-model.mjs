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
if (newCount !== 11) errors.push(`Expected 11 new-aggregate classifications, found ${newCount}`);
if (extendCount !== 8) errors.push(`Expected 8 extend classifications, found ${extendCount}`);

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

const migrationNumbers = [
  ...contents.migration.matchAll(/^\| (00(?:3[4-9]|4\d|5[0-3])) \|/gm),
].map((match) => Number(match[1]));
if (migrationNumbers.length !== 20) {
  errors.push(`Expected 20 planned migrations (0034–0053), found ${migrationNumbers.length}`);
} else if (migrationNumbers.some((number, index) => number !== 34 + index)) {
  errors.push('Planned migration sequence is not continuous from 0034 to 0053');
}

for (const heading of [
  '## Stage 0 — Decision and baseline freeze',
  '## Stage 1 — Shared foundations',
  '## Stage 2 — P0 domain migrations',
  '## Stage 3 — P1 lifecycle migrations',
  '## Cutover gates',
  '## Rollback',
]) {
  if (!contents.migration.includes(heading)) errors.push(`Migration plan is missing ${heading}`);
}

if (errors.length > 0) {
  console.error(`Business process data-model checks failed (${errors.length}):`);
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log('Business process data-model checks passed: 19 capabilities, 11 new aggregates, 8 extensions, 20 planned migrations.');
}

