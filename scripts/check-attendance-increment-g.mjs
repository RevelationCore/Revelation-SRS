import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const migration = read('packages/db/migrations/0040_ukvi_engagement_decision_boundary.sql');
const service = read('apps/api/src/platform/regulatory/ukvi-service.ts');
const routes = read('apps/api/src/routes/regulatory-ukvi.ts');
const ui = read('apps/admin/src/pages/UkviPage.tsx');
const tests = read('apps/api/test/regulatory-ukvi.int.test.ts');
const e2e = read('e2e/admin-ukvi-sponsor.spec.ts');
const errors = [];

for (const marker of [
  'ukvi_engagement_evidence_snapshot', 'ukvi_sponsor_decision',
  'authorised_by" <> "decided_by', 'reconciliation-required',
  'UKVI governed evidence and decisions are append-only',
]) {
  if (!migration.includes(marker)) errors.push(`Migration is missing ${marker}`);
}
for (const marker of [
  'createEngagementEvidenceSnapshot', 'createSponsorDecision',
  'authoriseSponsorDecision', 'getOperationalStatus',
  'Direct attendance-report generation is retired',
  "exchangeTypeCode: 'ukvi-sponsor-report'",
]) {
  if (!service.includes(marker)) errors.push(`UKVI service is missing ${marker}`);
}
for (const marker of [
  'engagement-evidence-snapshots', 'sponsor-decisions/:decisionId/authorise',
  'operations/status',
]) {
  if (!routes.includes(marker)) errors.push(`UKVI routes are missing ${marker}`);
}
for (const marker of [
  'Sponsor decisions', 'Pending authorisation', 'Evidence reconciliation',
  'Failed/dead-letter exchanges', 'never automatically',
]) {
  if (!ui.includes(marker)) errors.push(`UKVI admin workspace is missing ${marker}`);
}
for (const marker of [
  'immutable sponsor evidence snapshot', 'separate human authorisation',
  'needs reconciliation', 'blocks the retired direct attendance-report path',
]) {
  if (!tests.includes(marker)) errors.push(`UKVI integration coverage is missing ${marker}`);
}
for (const marker of [
  'governed sponsor-decision and operational boundary',
  'never automatically changes academic status',
  'Authorise decision',
]) {
  if (!e2e.includes(marker)) errors.push(`UKVI browser coverage is missing ${marker}`);
}

if (errors.length) {
  console.error(`Attendance Increment G checks failed (${errors.length}):`);
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log('Attendance Increment G structural checks passed: immutable read model, human decision and independent authorisation, retired direct reporting, operational status and admin controls.');
}
