import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const service = read('apps/api/src/platform/engagement/engagement-policy-service.ts');
const evidenceService = read('apps/api/src/platform/engagement/engagement-service.ts');
const routes = read('apps/api/src/routes/engagement.ts');
const permissions = read('packages/domain/src/permissions.ts');
const events = read('packages/domain/src/events/index.ts');
const migration = read('packages/db/migrations/0038_engagement_policy_alert_immutability.sql');
const test = read('apps/api/test/engagement.int.test.ts');
const openapi = JSON.parse(read('apps/api/openapi/v1.json'));
const errors = [];

for (const [path, method] of [
  ['/api/v1/engagement/policies', 'post'], ['/api/v1/engagement/policies', 'get'],
  ['/api/v1/engagement/evaluations', 'post'], ['/api/v1/engagement/alerts', 'get'],
]) {
  if (!openapi.paths?.[path]?.[method]) errors.push(`OpenAPI is missing ${method.toUpperCase()} ${path}`);
}
if (!evidenceService.includes('tx.update(engagementAlerts)') || !evidenceService.includes('reevaluationRequired: true')) {
  errors.push('Observation correction does not mark affected alerts for re-evaluation');
}
for (const permission of [
  'engagement:policy:read', 'engagement:policy:manage', 'engagement:evaluation:run', 'engagement:alert:read',
]) {
  if (!permissions.includes(`'${permission}'`)) errors.push(`Permission catalogue is missing ${permission}`);
  if (!routes.includes(permission)) errors.push(`Routes do not enforce ${permission}`);
}
for (const control of [
  'evidenceSnapshot', 'evidenceHash', 'minimumAbsenceRate', 'suspended-reconciliation',
  'reevaluationRequired', 'automatedAdverseActionPermitted: false', 'Approved engagement policy version',
]) {
  if (!service.includes(control)) errors.push(`Policy evaluation is missing control ${control}`);
}
for (const control of [
  'engagement_policy_version_immutability_guard', 'engagement_alert_evidence_immutability_guard',
  'evidence_snapshot <> OLD.evidence_snapshot', 'alert evidence and explanation are immutable',
]) {
  if (!migration.includes(control)) errors.push(`Database migration is missing control ${control}`);
}
for (const event of ['ENGAGEMENT_ALERT_RAISED', 'ENGAGEMENT_ALERT_SUSPENDED']) {
  if (!events.includes(event)) errors.push(`Event catalogue is missing ${event}`);
}
for (const schema of [
  'schemas/events/engagement/alert-raised/v1.json', 'schemas/events/engagement/alert-suspended/v1.json',
]) {
  if (!existsSync(resolve(root, schema))) errors.push(`Generated event schema is missing ${schema}`);
}
for (const scenario of [
  'uses an approved policy version to create one explainable review alert',
  'suspends an alert when the source evidence is disputed',
  'rejects draft policies and protects policy and alert routes with RBAC',
]) {
  if (!test.includes(scenario)) errors.push(`Integration test is missing scenario: ${scenario}`);
}
if (errors.length) {
  console.error(`Attendance Increment D checks failed (${errors.length}):`);
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log('Attendance Increment D structural checks passed: versioned policies, deterministic evidence snapshots, duplicate-safe explainable alerts, reconciliation suspension, RBAC and typed events.');
}
