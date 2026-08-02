import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const service = read('apps/api/src/platform/engagement/engagement-intervention-service.ts');
const routes = read('apps/api/src/routes/engagement-interventions.ts');
const migration = read('packages/db/migrations/0003_engagement_and_attendance.sql');
const permissions = read('packages/domain/src/permissions.ts');
const events = read('packages/domain/src/events/index.ts');
const test = read('apps/api/test/engagement.int.test.ts');
const openapi = JSON.parse(read('apps/api/openapi/v1.json'));
const errors = [];

for (const [path, method] of [
  ['/api/v1/engagement/alerts/{alertId}/triage', 'post'],
  ['/api/v1/engagement/cases/{caseId}', 'get'],
  ['/api/v1/engagement/cases/{caseId}/contacts', 'post'],
  ['/api/v1/engagement/cases/{caseId}/actions', 'post'],
  ['/api/v1/engagement/cases/{caseId}/review', 'post'],
]) {
  if (!openapi.paths?.[path]?.[method]) errors.push(`OpenAPI is missing ${method.toUpperCase()} ${path}`);
}
for (const permission of ['engagement:case:read', 'engagement:case:manage', 'engagement:case:refer']) {
  if (!permissions.includes(`'${permission}'`)) errors.push(`Permission catalogue is missing ${permission}`);
  if (!routes.includes(permission)) errors.push(`Routes do not enforce ${permission}`);
}
for (const control of [
  'Alert requires evidence reconciliation before intervention', 'expectedVersionId',
  'sponsor-compliance-review', 'restricted health, disability or safeguarding narrative',
  'workflowInstanceId', 'idempotencyKey',
]) {
  if (!service.includes(control)) errors.push(`Intervention service is missing control ${control}`);
}
for (const control of [
  'engagement_case_idempotency_unique', 'engagement_contact_idempotency_unique',
  'engagement_action_idempotency_unique', 'engagement_referral_idempotency_unique',
  'engagement_case_history_guard', 'engagement_contact_history_guard', 'engagement_referral_history_guard',
]) {
  if (!migration.includes(control)) errors.push(`Migration is missing control ${control}`);
}
for (const event of [
  'ENGAGEMENT_INTERVENTION_OPENED', 'ENGAGEMENT_INTERVENTION_REVIEWED',
  'ENGAGEMENT_REFERRAL_CREATED', 'ENGAGEMENT_INTERVENTION_CLOSED',
]) {
  if (!events.includes(event)) errors.push(`Event catalogue is missing ${event}`);
}
for (const schema of [
  'intervention-opened', 'intervention-reviewed', 'referral-created', 'intervention-closed',
]) {
  if (!existsSync(resolve(root, `schemas/events/engagement/${schema}/v1.json`))) {
    errors.push(`Generated event schema is missing ${schema}`);
  }
}
for (const scenario of [
  'opens one assigned intervention from a triaged alert idempotently',
  'records accessible contacts and actions without restricted narrative',
  'creates a minimum-necessary referral without making a status or sponsor decision',
  'closes a case with an authorised outcome and immutable prior version',
]) {
  if (!test.includes(scenario)) errors.push(`Integration test is missing scenario: ${scenario}`);
}
if (errors.length) {
  console.error(`Attendance Increment E checks failed (${errors.length}):`);
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log('Attendance Increment E structural checks passed: triage, assigned cases, accessible contact, actions, authoritative reviews, restricted referrals, idempotency, append-only history and typed events.');
}
