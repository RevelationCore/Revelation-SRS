/**
 * ADR-033 Guard: a core adjustment, and the distributions that send it to the
 * VLE, exams and attendance, are written only by the code that holds an
 * authority for them. Any other writer is a second door past the decision.
 */
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const REPO = fileURLToPath(new URL('../../../../', import.meta.url));

/** Source trees that run against the core database. */
const ROOTS = ['apps', 'packages', 'modules', 'adapters', 'scripts'];

/** Each path a writer may have, with why. */
const ALLOWED: Array<[RegExp, string]> = [
  [/^apps\/api\/src\/platform\/adjustments\/adjustment-service\.ts$/, 'the recording path, expiry, outcome documents and batch release'],
  [/^apps\/api\/src\/platform\/adjustments\/adjustment-proposal-service\.ts$/, 'the approval effect of a manual proposal'],
  [/^packages\/migration-tools\/src\/importer\/phases\.ts$/, 'the legacy import, released separately'],
  [/^packages\/demo-data\/src\/scenarios\/[^/]+\.ts$/, 'demo scenarios, each naming its demo wellbeing case'],
];

// insert(t), batchInsert(db, t, ...), and raw SQL.
const WRITE = [
  /\b(?:insert|batchInsert)\s*\(\s*(?:[\w.]+\s*,\s*)?(?:reasonableAdjustments|adjustmentDistributions)\b/,
  /INSERT\s+INTO\s+"?(?:reasonable_adjustment|adjustment_distribution)"?[\s(]/i,
];

async function sourceFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (['node_modules', 'dist', 'test', 'tests', 'e2e', '.turbo', 'coverage'].includes(e.name)) continue;
    const path = join(dir, e.name);
    if (e.isDirectory()) out.push(...await sourceFiles(path));
    else if (/\.(ts|tsx|mts|mjs|js)$/.test(e.name) && !/\.(test|spec|d)\.[mc]?[tj]sx?$/.test(e.name)) out.push(path);
  }
  return out;
}

async function writers(): Promise<string[]> {
  const found: string[] = [];
  for (const root of ROOTS) {
    for (const file of await sourceFiles(join(REPO, root))) {
      const text = await readFile(file, 'utf8');
      if (WRITE.some((re) => re.test(text))) found.push(relative(REPO, file).split('\\').join('/'));
    }
  }
  return found.sort();
}

describe('writers of reasonable_adjustment and adjustment_distribution', () => {
  it('are only the code that holds an authority for them', async () => {
    const outside = (await writers()).filter((f) => !ALLOWED.some(([re]) => re.test(f)));
    expect(outside, 'a new writer must record under an authority (ADR-033): use AdjustmentService.recordAuthorisedAdjustment').toEqual([]);
  });

  it('finds the writers it knows about, so a broken pattern cannot pass silently', async () => {
    const found = await writers();
    expect(found).toEqual(expect.arrayContaining([
      'apps/api/src/platform/adjustments/adjustment-service.ts',
      'packages/migration-tools/src/importer/phases.ts',
      'packages/demo-data/src/scenarios/assessment-marks.ts',
    ]));
  });
});
