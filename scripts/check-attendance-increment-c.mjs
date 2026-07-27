import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const route = read('apps/api/src/routes/engagement.ts');
const service = read('apps/api/src/platform/engagement/engagement-service.ts');
const permissions = read('packages/domain/src/permissions.ts');
const eventIndex = read('packages/domain/src/events/index.ts');
const test = read('apps/api/test/engagement.int.test.ts');
const openapi = JSON.parse(read('apps/api/openapi/v1.json'));
const errors = [];

const endpoints = [
  ['/api/v1/engagement/events', 'post'],
  ['/api/v1/engagement/events', 'get'],
  ['/api/v1/engagement/events/{eventId}/observations', 'post'],
  ['/api/v1/engagement/observations/{observationId}/corrections', 'post'],
  ['/api/v1/engagement/students/{personId}/timeline', 'get'],
];

for (const [path, method] of endpoints) {
  if (!openapi.paths?.[path]?.[method]) errors.push(`OpenAPI is missing ${method.toUpperCase()} ${path}`);
}

for (const permission of [
  'engagement:event:read',
  'engagement:event:write',
  'engagement:observation:create',
  'engagement:observation:correct',
  'engagement:timeline:read',
]) {
  if (!permissions.includes(`'${permission}'`)) errors.push(`Permission catalogue is missing ${permission}`);
  if (!route.includes(permission)) errors.push(`Routes do not enforce ${permission}`);
}

for (const event of [
  'ENGAGEMENT_EXPECTED_EVENT_CREATED',
  'ENGAGEMENT_OBSERVATION_RECORDED',
  'ENGAGEMENT_OBSERVATION_CORRECTED',
]) {
  if (!eventIndex.includes(event)) errors.push(`Event catalogue is missing ${event}`);
}

for (const schema of [
  'schemas/events/engagement/expected-event-created/v1.json',
  'schemas/events/engagement/observation-recorded/v1.json',
  'schemas/events/engagement/observation-corrected/v1.json',
]) {
  if (!existsSync(resolve(root, schema))) errors.push(`Generated event schema is missing ${schema}`);
}

for (const control of [
  'createExpectedEvent',
  'recordObservation',
  'correctObservation',
  'getStudentTimeline',
  'idempotencyKey',
  'engagementObservationRevisions',
  'recordedUntil',
]) {
  if (!service.includes(control)) errors.push(`Engagement service is missing control ${control}`);
}

for (const scenario of [
  'creates, lists and publishes an expected event idempotently by source version',
  'records an observation once for repeated idempotency keys',
  'corrects an observation by appending a version and revision record',
  'returns the current expected-event and observation timeline',
  'rejects missing idempotency headers and invalid controlled values',
  'enforces permissions and tenant isolation',
]) {
  if (!test.includes(scenario)) errors.push(`Integration test is missing scenario: ${scenario}`);
}

if (errors.length > 0) {
  console.error(`Attendance Increment C checks failed (${errors.length}):`);
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log('Attendance Increment C structural checks passed: 5 API operations, RBAC, idempotency, append-only corrections, typed events, OpenAPI and integration-test coverage.');
}
