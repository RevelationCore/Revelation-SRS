import { createHash, randomUUID } from 'node:crypto';

import { and, eq, isNull } from 'drizzle-orm';
import type { PgDatabase, PgQueryResultHKT, PgTransaction } from 'drizzle-orm/pg-core';

import {
  type DocumentStorageAdapter,
  type StoreDocumentInput,
  type StoredDocument,
  type RetrievedDocument,
  type DocumentMetadata,
  DocumentNotFoundError,
  DocumentTooLargeError,
  DocumentTypeNotAllowedError,
} from './adapter.js';
import { type DocumentScanner, NoopScanner } from './scanner.js';
import { documents, documentAccessLog } from './schema.js';

// Generic over the caller's own schema type so this accepts either a full
// database handle or a transaction from any service that has installed
// this package's tables alongside its own (e.g. the wellbeing module) —
// without this package needing to depend on that service's schema type.
type Db<TSchema extends Record<string, unknown> = Record<string, never>> =
  PgDatabase<PgQueryResultHKT, TSchema> | PgTransaction<PgQueryResultHKT, TSchema>;

const DEFAULT_MAX_BYTES = 15 * 1024 * 1024; // 15MB — generous for a scanned letter/report, not arbitrary binaries

const DEFAULT_ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

export interface PostgresDocumentAdapterOptions {
  scanner?:            DocumentScanner;
  maxBytes?:           number;
  allowedMimeTypes?:   Set<string>;
}

async function writeAccessLog<TSchema extends Record<string, unknown>>(
  db: Db<TSchema>,
  input: { documentId: string; tenantId: string; actorId: string; action: 'store' | 'retrieve' | 'delete' },
): Promise<void> {
  await db.insert(documentAccessLog).values({
    id:         randomUUID(),
    documentId: input.documentId,
    tenantId:   input.tenantId,
    actorId:    input.actorId,
    action:     input.action,
  });
}

function toMetadata(row: typeof documents.$inferSelect): DocumentMetadata {
  return {
    documentId:     row.id,
    tenantId:       row.tenantId,
    ownerService:   row.ownerService,
    ownerRef:       row.ownerRef,
    filename:       row.filename,
    mimeType:       row.mimeType,
    sizeBytes:      row.sizeBytes,
    checksumSha256: row.checksumSha256,
    statusCode:     row.statusCode,
    uploadedBy:     row.uploadedBy,
    uploadedAt:     row.uploadedAt,
    deletedAt:      row.deletedAt,
  };
}

/**
 * Default DocumentStorageAdapter implementation: content stored directly
 * in Postgres as bytea. See adapter.ts for the interface contract and
 * schema.ts for the table shapes this reads/writes.
 */
export function createPostgresDocumentAdapter<TSchema extends Record<string, unknown>>(
  db: Db<TSchema>,
  options: PostgresDocumentAdapterOptions = {},
): DocumentStorageAdapter {
  const scanner          = options.scanner ?? new NoopScanner();
  const maxBytes         = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const allowedMimeTypes = options.allowedMimeTypes ?? DEFAULT_ALLOWED_MIME_TYPES;

  return {
    async store(input: StoreDocumentInput): Promise<StoredDocument> {
      if (input.content.byteLength > maxBytes) {
        throw new DocumentTooLargeError(input.content.byteLength, maxBytes);
      }
      if (!allowedMimeTypes.has(input.mimeType)) {
        throw new DocumentTypeNotAllowedError(input.mimeType);
      }

      const checksumSha256 = createHash('sha256').update(input.content).digest('hex');
      const scanResult     = await scanner.scan(input.content);
      const documentId     = randomUUID();

      await db.insert(documents).values({
        id:             documentId,
        tenantId:       input.tenantId,
        ownerService:   input.ownerService,
        ownerRef:       input.ownerRef,
        filename:       input.filename,
        mimeType:       input.mimeType,
        sizeBytes:      input.content.byteLength,
        checksumSha256,
        content:        input.content,
        statusCode:     scanResult,
        uploadedBy:     input.actorId,
      });

      await writeAccessLog(db, { documentId, tenantId: input.tenantId, actorId: input.actorId, action: 'store' });

      return { documentId, checksumSha256, sizeBytes: input.content.byteLength, statusCode: scanResult };
    },

    async retrieve(tenantId: string, documentId: string, actorId: string): Promise<RetrievedDocument> {
      const [row] = await db.select().from(documents)
        .where(and(eq(documents.id, documentId), eq(documents.tenantId, tenantId), isNull(documents.deletedAt)))
        .limit(1);

      if (!row || row.content === null) throw new DocumentNotFoundError(documentId);

      await writeAccessLog(db, { documentId, tenantId, actorId, action: 'retrieve' });

      return {
        documentId:     row.id,
        filename:       row.filename,
        mimeType:       row.mimeType,
        sizeBytes:      row.sizeBytes,
        checksumSha256: row.checksumSha256,
        content:        row.content,
        statusCode:     row.statusCode,
      };
    },

    async getMetadata(tenantId: string, documentId: string): Promise<DocumentMetadata> {
      const [row] = await db.select().from(documents)
        .where(and(eq(documents.id, documentId), eq(documents.tenantId, tenantId)))
        .limit(1);

      if (!row) throw new DocumentNotFoundError(documentId);
      return toMetadata(row);
    },

    async softDelete(tenantId: string, documentId: string, actorId: string, reason: string): Promise<void> {
      const result = await db.update(documents)
        .set({ content: null, deletedAt: new Date(), deletedBy: actorId, deletedReason: reason })
        .where(and(eq(documents.id, documentId), eq(documents.tenantId, tenantId), isNull(documents.deletedAt)))
        .returning({ id: documents.id });

      if (result.length === 0) throw new DocumentNotFoundError(documentId);

      await writeAccessLog(db, { documentId, tenantId, actorId, action: 'delete' });
    },

    async listByOwner(tenantId: string, ownerService: string, ownerRef: string): Promise<DocumentMetadata[]> {
      const rows = await db.select().from(documents)
        .where(and(
          eq(documents.tenantId, tenantId),
          eq(documents.ownerService, ownerService),
          eq(documents.ownerRef, ownerRef),
          isNull(documents.deletedAt),
        ));

      return rows.map(toMetadata);
    },
  };
}
