export * from './adapter.js';
export * from './scanner.js';
export * from './schema.js';
export { ClamdScanner, type ClamdScannerOptions } from './clamd-scanner.js';
export { assertDocumentScannerConfig, createDocumentScanner, loadDocumentScannerConfig, type DocumentScannerConfig } from './config.js';
export {
  createDocumentStore,
  DEFAULT_ALLOWED_MIME_TYPES,
  DEFAULT_MAX_BYTES,
  type DocumentSecurityObserver,
  type DocumentStore,
  type DocumentStoreOptions,
  type RescanSummary,
  type SystemContentReason,
  type UploadInput,
} from './document-store.js';
export type { ScannedUpload } from './scanned-upload.js';
export type { DocumentsDb } from './postgres-adapter.js';
// ADR-030: createPostgresDocumentAdapter is no longer exported; use documentStore.adapter(db).
