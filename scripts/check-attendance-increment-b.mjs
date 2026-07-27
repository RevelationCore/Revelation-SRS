import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const migration = readFileSync(resolve(root, 'packages/db/migrations/0037_engagement_intervention.sql'), 'utf8');
const schema = readFileSync(resolve(root, 'packages/db/src/schema/engagement.ts'), 'utf8');
const exportsFile = readFileSync(resolve(root, 'packages/db/src/schema/index.ts'), 'utf8');
const journal = JSON.parse(readFileSync(resolve(root, 'packages/db/migrations/meta/_journal.json'), 'utf8'));
const test = readFileSync(resolve(root, 'packages/db/test/engagement-schema.test.ts'), 'utf8');
const errors = [];

const tables = [
  'engagement_policy_version',
  'expected_engagement_event',
  'engagement_observation',
  'engagement_observation_revision',
  'engagement_alert',
  'engagement_intervention_case',
  'engagement_contact_attempt',
  'engagement_action',
  'engagement_referral',
];

for (const table of tables) {
  if (!migration.includes(`CREATE TABLE "${table}"`)) errors.push(`Migration is missing table ${table}`);
  if (!migration.includes(`'${table}'`)) errors.push(`RLS table list is missing ${table}`);
}

for (const table of [
  'engagement_policy_version',
  'expected_engagement_event',
  'engagement_observation',
  'engagement_alert',
  'engagement_intervention_case',
]) {
  if (!migration.includes(`"${table}_current_version_unique"`)) {
    errors.push(`Migration is missing current-version constraint for ${table}`);
  }
}

for (const control of [
  'engagement_observation_idempotency_unique',
  'engagement_observation_history_guard',
  'engagement_observation_revision_history_guard',
  'ENABLE ROW LEVEL SECURITY',
  'FORCE ROW LEVEL SECURITY',
  'WITH CHECK',
]) {
  if (!migration.includes(control)) errors.push(`Migration is missing control ${control}`);
}

const valueSets = [...migration.matchAll(/\('engagement-[a-z-]+-code', '[^']+', 'srs-internal'/g)];
if (valueSets.length !== 9) errors.push(`Expected 9 engagement value-set definitions, found ${valueSets.length}`);

const drizzleTables = [...schema.matchAll(/pgTable\('([^']+)'/g)].map((match) => match[1]);
for (const table of tables) {
  if (!drizzleTables.includes(table)) errors.push(`Drizzle schema is missing ${table}`);
}
if (!exportsFile.includes("export * from './engagement.js';")) errors.push('Engagement schema is not exported');

const journalEntries = journal.entries.filter((entry) => entry.tag === '0037_engagement_intervention');
if (journalEntries.length !== 1) errors.push(`Expected one migration journal entry for 0037, found ${journalEntries.length}`);

for (const phrase of [
  'tenant-isolated aggregate tables',
  'prevents tenant B from seeing tenant A',
  'enforces source idempotency',
  'rejects mutation of closed history',
]) {
  if (!test.includes(phrase)) errors.push(`Integration test is missing coverage: ${phrase}`);
}

if (errors.length > 0) {
  console.error(`Attendance Increment B checks failed (${errors.length}):`);
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log('Attendance Increment B structural checks passed: 9 tables, 5 bitemporal authorities, RLS, immutable correction history, 9 value sets and integration-test coverage.');
}
