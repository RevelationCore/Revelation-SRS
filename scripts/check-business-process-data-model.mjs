import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/**
 * Keeps the business-process data-model delta honest against the schema.
 *
 * Every BPR-D row's disposition is checked against the tables the target
 * model names for it and the tables the migrations actually create, so the
 * assessment cannot quietly drift as features land (it did, from 2026-08-02
 * to 2026-11-15). Also guards the pre-production migration squash.
 */

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

// Pre-production, the core migration set is re-squashed when it grows past
// this. See "Re-squashing" in the migration plan.
const MAX_CORE_MIGRATIONS = 10;

const DISPOSITIONS = {
  'Partial implementation': 'partial',
  'Extend': 'extend',
  'New aggregate': 'new',
  'Resolved — no extension planned': 'resolved',
  'Existing sufficient': 'sufficient',
};
const SUMMARY_LABELS = {
  partial: 'Partial implementation',
  extend: 'Extend existing aggregate',
  new: 'New aggregate',
  resolved: 'Resolved — no extension planned',
  sufficient: 'Existing sufficient',
};

// ── Tables the migrations create ────────────────────────────────────────────

function migrationFiles() {
  const journal = JSON.parse(readFileSync(resolve(root, 'packages/db/migrations/meta/_journal.json'), 'utf8'));
  const core = journal.entries.map((e) => resolve(root, 'packages/db/migrations', `${e.tag}.sql`));
  const extra = [];
  for (const parent of ['modules', 'adapters']) {
    const base = resolve(root, parent);
    if (!existsSync(base)) continue;
    for (const name of readdirSync(base)) {
      const dir = join(base, name, 'migrations');
      if (!existsSync(dir)) continue;
      extra.push(...readdirSync(dir).filter((f) => f.endsWith('.sql')).sort().map((f) => join(dir, f)));
    }
  }
  return { core, all: [...core, ...extra] };
}

const { core: coreFiles, all: allFiles } = migrationFiles();
const tables = new Set();
const statement = /\b(CREATE|DROP)\s+TABLE\s+(?:IF\s+(?:NOT\s+)?EXISTS\s+)?((?:"?[a-z_][a-z0-9_]*"?\.)?"?[a-z_][a-z0-9_]*"?(?:\s*,\s*(?:"?[a-z_][a-z0-9_]*"?\.)?"?[a-z_][a-z0-9_]*"?)*)/gi;
for (const file of allFiles) {
  if (!existsSync(file)) {
    errors.push(`Journal lists a migration that does not exist: ${file}`);
    continue;
  }
  const text = readFileSync(file, 'utf8').replace(/--[^\n]*/g, '');
  for (const [, verb, list] of text.matchAll(statement)) {
    for (const ref of list.split(',')) {
      const name = ref.trim().replaceAll('"', '').split('.').pop().toLowerCase();
      if (verb.toUpperCase() === 'CREATE') tables.add(name);
      else tables.delete(name);
    }
  }
}

// ── Rows ────────────────────────────────────────────────────────────────────

const expectedIds = Array.from({ length: 19 }, (_, index) => `BPR-D${String(index + 1).padStart(2, '0')}`);
const deltaRows = new Map();
for (const line of contents.delta.split('\n')) {
  const m = /^\| (BPR-D\d{2}) \|/.exec(line);
  if (!m) continue;
  if (deltaRows.has(m[1])) errors.push(`${m[1]} has more than one delta assessment row`);
  const cells = line.split('|').map((c) => c.trim());
  const disposition = /^\*\*(.+)\*\*$/.exec(cells[5] ?? '')?.[1];
  deltaRows.set(m[1], disposition);
}
const targetRows = new Map();
for (const line of contents.target.split('\n')) {
  const m = /^\| (BPR-D\d{2}) \| (.*?) \|/.exec(line);
  if (!m) continue;
  if (targetRows.has(m[1])) errors.push(`${m[1]} has more than one target-model row`);
  targetRows.set(m[1], [...m[2].matchAll(/`([a-z][a-z0-9_]*)`/g)].map((t) => t[1]));
}

const counts = Object.fromEntries(Object.values(DISPOSITIONS).map((k) => [k, 0]));
for (const id of expectedIds) {
  if (!deltaRows.has(id)) { errors.push(`${id} must have a delta assessment row`); continue; }
  if (!targetRows.has(id)) { errors.push(`${id} must have a target-model row`); continue; }
  const label = deltaRows.get(id);
  const kind = DISPOSITIONS[label];
  if (!kind) { errors.push(`${id}: unknown disposition "${label ?? '(none)'}" — use one of ${Object.keys(DISPOSITIONS).join(', ')}`); continue; }
  counts[kind] += 1;

  const named = targetRows.get(id);
  if (kind === 'resolved') continue;
  if (named.length === 0) { errors.push(`${id}: the target-model row names no tables`); continue; }
  const missing = named.filter((t) => !tables.has(t));
  const [rootTable] = named;

  if ((kind === 'new' || kind === 'extend') && missing.length === 0) {
    errors.push(`${id} is marked ${label}, but every target table exists (${named.join(', ')}) — re-assess it`);
  } else if ((kind === 'new' || kind === 'extend') && tables.has(rootTable)) {
    errors.push(`${id} is marked ${label}, but its root table ${rootTable} exists — is it a Partial implementation?`);
  } else if (kind === 'partial' && !tables.has(rootTable)) {
    errors.push(`${id} is marked Partial implementation, but its root table ${rootTable} does not exist`);
  } else if (kind === 'sufficient' && missing.length > 0) {
    errors.push(`${id} is marked Existing sufficient, but ${missing.join(', ')} do not exist`);
  }
}

// The executive summary must agree with the rows.
for (const [kind, label] of Object.entries(SUMMARY_LABELS)) {
  const m = new RegExp(`^\\| ${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\| (\\d+) \\|`, 'm').exec(contents.delta);
  const stated = m ? Number(m[1]) : 0;
  if (stated !== counts[kind]) errors.push(`Executive result says ${stated} "${label}", but ${counts[kind]} rows have that disposition`);
}

// ── Links, fences, migration plan ───────────────────────────────────────────

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
  '## Re-squashing',
  '## Stage 1 — Shared foundations',
  '## Stage 2 — P0 domain migrations',
  '## Stage 3 — P1 lifecycle migrations',
  '## Cutover gates',
  '## Rollback',
]) {
  if (!contents.migration.includes(heading)) errors.push(`Migration plan is missing ${heading}`);
}

if (coreFiles.length > MAX_CORE_MIGRATIONS) {
  errors.push(`${coreFiles.length} core migrations, more than ${MAX_CORE_MIGRATIONS}: re-squash them (see "Re-squashing" in docs/architecture/business-process-data-migration-plan.md)`);
}

if (errors.length > 0) {
  console.error(`Business process data-model checks failed (${errors.length}):`);
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log(
    `Business process data-model checks passed: 19 capabilities (${counts.partial} partial, ${counts.extend} extend, ${counts.new} new aggregate, ${counts.resolved} resolved, ${counts.sufficient} sufficient), ` +
    `${tables.size} tables across ${allFiles.length} migrations, ${coreFiles.length} core migrations.`,
  );
}
