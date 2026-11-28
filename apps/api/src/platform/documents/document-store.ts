import {
  createDocumentStore,
  type DocumentScanner,
  type DocumentSecurityObserver,
} from '@revelation-srs/documents';
import { withTenantContext, type Db } from '@revelation-srs/db';
import type { FastifyBaseLogger } from 'fastify';

/**
 * Core's document store (ADR-030), built once at the composition root and
 * injected into the services that store documents. Its observer writes the
 * structured events the Loki alerts match; it never logs a filename.
 */
export function createApiDocumentStore(db: Db, scanner: DocumentScanner, log: FastifyBaseLogger) {
  return createDocumentStore({
    scanner,
    runInTenant: (tenantId, fn) => withTenantContext(db, tenantId, fn),
    observer: documentSecurityLogObserver(log),
  });
}

export type ApiDocumentStore = ReturnType<typeof createApiDocumentStore>;

/** Structured log events for scanning (ADR-030 item 8), shared by core and the worker. */
export function documentSecurityLogObserver(log: FastifyBaseLogger): DocumentSecurityObserver {
  return {
    uploadRejected: (e) => log.warn({ event: 'documents.upload.rejected', ...e }, 'Upload rejected by the malware check'),
    scannerUnavailable: (e) => log.error({ event: 'documents.scanner.unavailable', ...e }, 'Document scanner unavailable; upload refused'),
    retrievalRefused: (e) => log.info({ event: 'documents.retrieval.refused', ...e }, 'Document not served: it has not passed the malware check'),
    scanned: (e) => log.debug({ event: 'documents.scan.completed', ...e }, 'Document scanned'),
    rescanInfected: (e) => log.warn({ event: 'documents.rescan.infected', ...e }, 'Rescan found a stored document infected; its content was removed'),
  };
}
