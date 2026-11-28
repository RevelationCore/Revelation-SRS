import { randomUUID } from 'node:crypto';

import { and, eq, isNull, ne } from 'drizzle-orm';
import type { ExtractTablesWithRelations } from 'drizzle-orm';
import type { PgDatabase, PgQueryResultHKT, PgTransaction } from 'drizzle-orm/pg-core';

import {
  type DocumentStorageAdapter,
  type StoredDocument,
  type RetrievedDocument,
  type DocumentMetadata,
  DocumentNotAvailableError,
  DocumentNotFoundError,
} from './adapter.js';
import { assertIssued, type ScannedUpload } from './scanned-upload.js';
import { documents, documentAccessLog } from './schema.js';

// Generic over the caller's own schema type so this accepts either a full
// database handle or a transaction from any service that has installed
// this package's tables alongside its own (e.g. the wellbeing module) —
// without this package needing to depend on that service's schema type.
export type DocumentsDb<TSchema extends Record<string, unknown>, H extends PgQueryResultHKT> =
  PgDatabase<H, TSchema> | PgTransaction<H, TSchema, ExtractTablesWithRelations<TSchema>>;

/** Observer for what the adapter refuses (ADR-030 item 8); the store passes its own. */
export interface AdapterObserver {
  retrievalRefused(event: { tenantId: string; documentId: string; reason: 'pending-scan' | 'infected'; actorId: string }): void;
}

export async function writeAccessLog<TSchema extends Record<string, unknown>, H extends PgQueryResultHKT>(
  db: DocumentsDb<TSchema, H>,
  input: { documentId: string; tenantId: string; actorId: string; action: 'store' | 'retrieve' | 'delete' | 'upload-rejected' | 'rescan' },
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
 * in Postgres as bytea. Reached only through documentStore.adapter(db)
 * (ADR-030): it stores only uploads the store scanned, and serves only
 * clean or system-generated content.
 */
export function createPostgresDocumentAdapter<TSchema extends Record<string, unknown>, H extends PgQueryResultHKT>(
  db: DocumentsDb<TSchema, H>,
  observer: AdapterObserver,
): DocumentStorageAdapter {
  return {
    async store(upload: ScannedUpload): Promise<StoredDocument> {
      assertIssued(upload);
      const { input, checksumSha256, verdict, scannedAt } = upload;
      const scanResult = verdict ? 'clean' : 'system-generated';
      const documentId = randomUUID();

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
        scannedAt,
        scanEngine:     verdict?.engine ?? null,
        scanDatabaseVersion: verdict?.databaseVersion ?? null,
        uploadedBy:     input.actorId,
      });

      await writeAccessLog(db, { documentId, tenantId: input.tenantId, actorId: input.actorId, action: 'store' });

      return { documentId, checksumSha256, sizeBytes: input.content.byteLength, statusCode: scanResult };
    },

    async retrieve(tenantId: string, documentId: string, actorId: string): Promise<RetrievedDocument> {
      const [row] = await db.select().from(documents)
        .where(and(eq(documents.id, documentId), eq(documents.tenantId, tenantId), isNull(documents.deletedAt)))
        .limit(1);

      if (!row) throw new DocumentNotFoundError(documentId);
      // ADR-030: only scanned or system-generated content is served. The
      // refusal is a log event, not an access-log row: nothing was disclosed
      // and the caller's transaction rolls back.
      if (row.statusCode === 'pending-scan' || row.statusCode === 'infected') {
        observer.retrievalRefused({ tenantId, documentId, reason: row.statusCode, actorId });
        throw new DocumentNotAvailableError(documentId, row.statusCode);
      }
      if (row.statusCode !== 'clean' && row.statusCode !== 'system-generated') throw new DocumentNotFoundError(documentId);
      if (row.content === null) throw new DocumentNotFoundError(documentId);

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
          ne(documents.statusCode, 'infected'),
        ));

      return rows.map(toMetadata);
    },
  };
}
