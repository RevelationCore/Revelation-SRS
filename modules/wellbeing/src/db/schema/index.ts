// Only the table definitions, not the adapter/scanner classes — this
// barrel feeds drizzle()'s `schema` option directly, which expects table
// (and relation) exports only.
export { documents, documentAccessLog } from '@revelation-srs/documents';
export * from './wellbeing-case.js';
export * from './disability.js';
export * from './adjustment.js';
export * from './circumstances.js';
export * from './mental-health.js';
export * from './event-tracking.js';
export * from './audit-log.js';
export * from './srs-handoff.js';
export * from './srs-ec-handoff.js';
