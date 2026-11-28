import { createDocumentStore, type DocumentScanner, type DocumentSecurityObserver } from '@revelation-srs/documents';
import type { FastifyBaseLogger } from 'fastify';

import { withWellbeingTenantContext, type WellbeingDb } from './db/client.js';

/**
 * The wellbeing service's document store (ADR-030): evidence is scanned
 * before it is stored, and only clean content is served. Built once in
 * buildApp. The observer writes the events the Loki alerts match and never
 * logs a filename.
 */
export function createWellbeingDocumentStore(db: WellbeingDb, scanner: DocumentScanner, log: FastifyBaseLogger) {
  const observer: DocumentSecurityObserver = {
    uploadRejected: (e) => log.warn({ event: 'documents.upload.rejected', ...e }, 'Upload rejected by the malware check'),
    scannerUnavailable: (e) => log.error({ event: 'documents.scanner.unavailable', ...e }, 'Document scanner unavailable; upload refused'),
    retrievalRefused: (e) => log.info({ event: 'documents.retrieval.refused', ...e }, 'Document not served: it has not passed the malware check'),
    scanned: (e) => log.debug({ event: 'documents.scan.completed', ...e }, 'Document scanned'),
    rescanInfected: (e) => log.warn({ event: 'documents.rescan.infected', ...e }, 'Rescan found a stored document infected; its content was removed'),
  };
  return createDocumentStore({ scanner, observer, runInTenant: (tenantId, fn) => withWellbeingTenantContext(db, tenantId, fn) });
}

export type WellbeingDocumentStore = ReturnType<typeof createWellbeingDocumentStore>;
