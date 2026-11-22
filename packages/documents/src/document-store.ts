import { createHash, randomUUID } from 'node:crypto';

import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import type { PgQueryResultHKT } from 'drizzle-orm/pg-core';

import {
  DocumentRejectedError,
  DocumentTooLargeError,
  DocumentTypeNotAllowedError,
  type DocumentStorageAdapter,
  type StoreDocumentInput,
} from './adapter.js';
import { createPostgresDocumentAdapter, writeAccessLog, type DocumentsDb } from './postgres-adapter.js';
import { issue, type ScannedUpload } from './scanned-upload.js';
import { DocumentScannerUnavailableError, type DocumentScanner } from './scanner.js';
import { documents } from './schema.js';

/**
 * The only way to store a document (ADR-030). Each service builds one at its
 * composition root and calls, in order: its own permission checks, then
 * scanUpload with no transaction open, then adapter(tx).store(scanned) in
 * its write transaction.
 */
export type UploadInput = StoreDocumentInput;

/** Server-generated content that contains nothing uploaded; adding a reason is a code change. */
export type SystemContentReason = 'award-document-render';

/** Structured events for logs and alerts (ADR-030 item 8). Never pass a filename: it may hold personal data. */
export interface DocumentSecurityObserver {
  uploadRejected(event: { tenantId: string; documentId: string; ownerService: string; ownerRef: string; actorId: string; checksumSha256: string; sizeBytes: number; mimeType: string; signature: string; engine: string }): void;
  scannerUnavailable(event: { tenantId: string; ownerService: string; cause: DocumentScannerUnavailableError['cause'] }): void;
  retrievalRefused(event: { tenantId: string; documentId: string; reason: 'pending-scan' | 'infected'; actorId: string }): void;
  scanned(event: { tenantId: string; ownerService: string; outcome: 'clean' | 'infected'; durationMs: number }): void;
  rescanInfected?(event: { tenantId: string; documentId: string; ownerService: string; signature: string; engine: string }): void;
}

export interface RescanSummary { checked: number; clean: number; infected: number; failed: number }

export interface DocumentStoreOptions<TSchema extends Record<string, unknown>, H extends PgQueryResultHKT> {
  scanner:          DocumentScanner;
  /** Runs fn in a transaction with the tenant's RLS context set. */
  runInTenant:      <T>(tenantId: string, fn: (db: DocumentsDb<TSchema, H>) => Promise<T>) => Promise<T>;
  observer:         DocumentSecurityObserver;
  maxBytes?:        number;
  allowedMimeTypes?: Set<string>;
}

export interface DocumentStore<TSchema extends Record<string, unknown>, H extends PgQueryResultHKT> {
  scanUpload(input: UploadInput): Promise<ScannedUpload>;
  systemContent(input: UploadInput, reason: SystemContentReason): ScannedUpload;
  adapter(db: DocumentsDb<TSchema, H>): DocumentStorageAdapter;
  rescanPending(tenantId: string, opts: { ownerServices?: string[]; excludeOwnerServices?: string[]; batchSize?: number }): Promise<RescanSummary>;
}

export const DEFAULT_MAX_BYTES = 15 * 1024 * 1024; // 15MB — generous for a scanned letter/report, not arbitrary binaries

export const DEFAULT_ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

export function createDocumentStore<TSchema extends Record<string, unknown>, H extends PgQueryResultHKT>(
  options: DocumentStoreOptions<TSchema, H>,
): DocumentStore<TSchema, H> {
  const { scanner, runInTenant, observer } = options;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const allowed  = options.allowedMimeTypes ?? DEFAULT_ALLOWED_MIME_TYPES;

  const checked = (input: UploadInput): string => {
    if (input.content.byteLength > maxBytes) throw new DocumentTooLargeError(input.content.byteLength, maxBytes);
    if (!allowed.has(input.mimeType)) throw new DocumentTypeNotAllowedError(input.mimeType);
    return createHash('sha256').update(input.content).digest('hex');
  };

  return {
    async scanUpload(input) {
      const checksumSha256 = checked(input);
      const started = Date.now(); // clock:allow — scan duration only
      let verdict;
      try {
        verdict = await scanner.scan(input.content, AbortSignal.timeout(10 * 60_000));
      } catch (err) {
        if (err instanceof DocumentScannerUnavailableError) {
          observer.scannerUnavailable({ tenantId: input.tenantId, ownerService: input.ownerService, cause: err.cause });
        }
        throw err;
      }
      observer.scanned({ tenantId: input.tenantId, ownerService: input.ownerService, outcome: verdict.verdict, durationMs: Date.now() - started }); // clock:allow
      const scannedAt = new Date(); // clock:allow — when the scan ran

      if (verdict.verdict === 'infected') {
        // Keep the metadata and signature, never the content, in a transaction
        // of its own so the record survives the failed request.
        const documentId = randomUUID();
        await runInTenant(input.tenantId, async (db) => {
          await db.insert(documents).values({
            id: documentId, tenantId: input.tenantId, ownerService: input.ownerService, ownerRef: input.ownerRef,
            filename: input.filename, mimeType: input.mimeType, sizeBytes: input.content.byteLength, checksumSha256,
            content: null, statusCode: 'infected', scannedAt, scanEngine: verdict.engine,
            scanDatabaseVersion: verdict.databaseVersion, scanSignature: verdict.signature, uploadedBy: input.actorId,
          });
          await writeAccessLog(db, { documentId, tenantId: input.tenantId, actorId: input.actorId, action: 'upload-rejected' });
        });
        observer.uploadRejected({
          tenantId: input.tenantId, documentId, ownerService: input.ownerService, ownerRef: input.ownerRef, actorId: input.actorId,
          checksumSha256, sizeBytes: input.content.byteLength, mimeType: input.mimeType, signature: verdict.signature, engine: verdict.engine,
        });
        throw new DocumentRejectedError(documentId, checksumSha256);
      }
      return issue({ input, checksumSha256, verdict, scannedAt });
    },

    systemContent(input, _reason) {
      return issue({ input, checksumSha256: checked(input), verdict: null, scannedAt: null });
    },

    adapter(db) {
      return createPostgresDocumentAdapter(db, { retrievalRefused: (e) => observer.retrievalRefused(e) });
    },

    async rescanPending(tenantId, opts) {
      const summary: RescanSummary = { checked: 0, clean: 0, infected: 0, failed: 0 };
      const batchSize = opts.batchSize ?? 50;
      const failedIds = new Set<string>();
      for (;;) {
        const batch = await runInTenant(tenantId, (db) => db.select({
          id: documents.id, ownerService: documents.ownerService, content: documents.content,
        }).from(documents).where(and(
          eq(documents.tenantId, tenantId), eq(documents.statusCode, 'pending-scan'), isNull(documents.deletedAt),
          ...(opts.ownerServices ? [inArray(documents.ownerService, opts.ownerServices)] : []),
        )).orderBy(asc(documents.uploadedAt)).limit(batchSize + failedIds.size));
        const todo = batch.filter((d) => !failedIds.has(d.id) && (!opts.excludeOwnerServices || !opts.excludeOwnerServices.includes(d.ownerService)));
        if (todo.length === 0) break;
        for (const doc of todo) {
          summary.checked++;
          if (doc.content === null) { failedIds.add(doc.id); summary.failed++; continue; }
          let verdict;
          try {
            verdict = await scanner.scan(doc.content, AbortSignal.timeout(10 * 60_000));
          } catch {
            failedIds.add(doc.id); summary.failed++; continue;
          }
          const scannedAt = new Date(); // clock:allow
          await runInTenant(tenantId, async (db) => {
            const updated = await db.update(documents).set(verdict.verdict === 'clean'
              ? { statusCode: 'clean', scannedAt, scanEngine: verdict.engine, scanDatabaseVersion: verdict.databaseVersion }
              : { statusCode: 'infected', content: null, scannedAt, scanEngine: verdict.engine, scanDatabaseVersion: verdict.databaseVersion, scanSignature: verdict.signature })
              .where(and(eq(documents.id, doc.id), eq(documents.statusCode, 'pending-scan')))
              .returning({ id: documents.id });
            if (updated.length > 0) await writeAccessLog(db, { documentId: doc.id, tenantId, actorId: 'system:document-rescan', action: 'rescan' });
          });
          if (verdict.verdict === 'clean') summary.clean++;
          else {
            summary.infected++;
            observer.rescanInfected?.({ tenantId, documentId: doc.id, ownerService: doc.ownerService, signature: verdict.signature, engine: verdict.engine });
          }
        }
      }
      return summary;
    },
  };
}
