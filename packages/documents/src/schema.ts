import { customType, index, integer, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * Dedicated Postgres schema namespace, sibling to whichever module's own
 * schema (e.g. `wellbeing`) this table set is installed alongside — same
 * per-capability namespacing convention as `pgSchema('wellbeing')` etc.
 */
export const docs = pgSchema('documents');

/**
 * bytea column type. postgres.js returns/accepts a Node Buffer for bytea
 * natively — no custom (de)serialization needed beyond declaring the
 * Postgres-side type name for Drizzle's DDL generation.
 */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return 'bytea';
  },
});

/**
 * Binary document storage. This is the *reference implementation* of
 * DocumentStorageAdapter (see adapter.ts) — content lives directly in
 * Postgres rather than an external object store, which keeps a
 * self-hosted deployment dependency-free. The adapter interface is the
 * seam a production deployment would use to swap this for S3/EDRMS
 * without touching any caller.
 *
 * Soft-delete only: `content` is nulled and `deletedAt`/`deletedReason`
 * set, but the row (and its checksum/metadata) is kept for audit —
 * matches this repo's bitemporal "never silently lose provenance"
 * convention even though this table isn't itself bitemporal (a document
 * either exists or has been disposed of; there's no "as-of" version
 * history for a binary blob the way there is for a typed record).
 */
export const documents = docs.table('document', {
  id:              uuid('id').primaryKey().defaultRandom(),
  tenantId:        uuid('tenant_id').notNull(),
  ownerService:    text('owner_service').notNull(),   // e.g. 'wellbeing' — which service/module registered this
  ownerRef:        text('owner_ref').notNull(),        // opaque id within that service, e.g. an adjustment_case id
  filename:        text('filename').notNull(),
  mimeType:        text('mime_type').notNull(),
  sizeBytes:       integer('size_bytes').notNull(),
  checksumSha256:  text('checksum_sha256').notNull(),
  content:         bytea('content'),
  statusCode:      text('status_code').notNull().default('pending-scan'), // pending-scan | clean | infected
  uploadedBy:      text('uploaded_by').notNull(),
  uploadedAt:      timestamp('uploaded_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt:       timestamp('deleted_at', { withTimezone: true }),
  deletedBy:       text('deleted_by'),
  deletedReason:   text('deleted_reason'),
}, (table) => [
  index('document_owner_idx').on(table.tenantId, table.ownerService, table.ownerRef),
]);

export type DocumentRow    = typeof documents.$inferSelect;
export type NewDocumentRow = typeof documents.$inferInsert;

/**
 * Append-only access log — who touched a document and when. Required for
 * any real audit trail over sensitive evidence (DSA medical letters etc.);
 * written automatically by the adapter on every operation, not left to
 * callers to remember.
 */
export const documentAccessLog = docs.table('document_access_log', {
  id:          uuid('id').primaryKey().defaultRandom(),
  documentId:  uuid('document_id').notNull(),
  tenantId:    uuid('tenant_id').notNull(),
  actorId:     text('actor_id').notNull(),
  action:      text('action').notNull(), // store | retrieve | delete
  occurredAt:  timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('document_access_log_document_idx').on(table.documentId),
]);

export type DocumentAccessLogRow    = typeof documentAccessLog.$inferSelect;
export type NewDocumentAccessLogRow = typeof documentAccessLog.$inferInsert;
