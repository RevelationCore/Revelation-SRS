// Only the table definitions, not the adapter/scanner classes — this
// barrel feeds drizzle()'s `schema` option directly, which expects table
// (and relation) exports only.
export { documents, documentAccessLog } from '@revelation-srs/documents';
export * from './tenant.js';
export * from './audit.js';
export * from './integration.js';
export * from './rules.js';
export * from './value-sets.js';
export * from './identity.js';
export * from './enrolment.js';
export * from './catalogue.js';
export * from './calendar.js';
export * from './registration.js';
export * from './module-selection.js';
export * from './assessment.js';
export * from './adjustment.js';
export * from './circumstances.js';
export * from './governance.js';
export * from './progression.js';
export * from './regulatory.js';
export * from './examEntry.js';
export * from './platform-workflow.js';
export * from './globalisation.js';
export * from './communications.js';
export * from './demo.js';
export * from './notifications.js';
export * from './engagement-outcome.js';
export * from './business-case.js';
export * from './identity-resolution.js';
export * from './rights.js';
export * from './pgr.js';
