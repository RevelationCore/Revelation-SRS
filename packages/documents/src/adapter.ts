/**
 * Pluggable document storage. `PostgresDocumentAdapter` (postgres-adapter.ts)
 * is the reference/default implementation; a production deployment can
 * swap in an S3-backed or real-EDRMS-backed implementation of this same
 * interface without changing any caller.
 *
 * Deliberately permission-agnostic: every method takes the acting actor
 * so it can write an access-log entry, but does NOT decide whether that
 * actor is allowed to act — the caller (e.g. the wellbeing module's
 * adjustment-case routes) must check authorization against its own
 * domain model (does this actor own this case? do they hold the right
 * permission?) before invoking the adapter at all.
 */

import type { ScannedUpload } from './scanned-upload.js';

/** What a caller hands the store to be scanned (ADR-030). */
export interface StoreDocumentInput {
  tenantId:     string;
  ownerService: string;
  ownerRef:     string;
  filename:     string;
  mimeType:     string;
  content:      Buffer;
  actorId:      string;
}

export interface StoredDocument {
  documentId:     string;
  checksumSha256: string;
  sizeBytes:      number;
  statusCode:     string;
}

export interface RetrievedDocument {
  documentId:     string;
  filename:       string;
  mimeType:       string;
  sizeBytes:      number;
  checksumSha256: string;
  content:        Buffer;
  statusCode:     string;
}

export interface DocumentMetadata {
  documentId:     string;
  tenantId:       string;
  ownerService:   string;
  ownerRef:       string;
  filename:       string;
  mimeType:       string;
  sizeBytes:      number;
  checksumSha256: string;
  statusCode:     string;
  uploadedBy:     string;
  uploadedAt:     Date;
  deletedAt:      Date | null;
}

export class DocumentNotFoundError extends Error {
  constructor(documentId: string) {
    super(`Document not found: ${documentId}`);
    this.name = 'DocumentNotFoundError';
  }
}

export class DocumentTooLargeError extends Error {
  constructor(sizeBytes: number, maxBytes: number) {
    super(`Document is ${sizeBytes} bytes, exceeding the ${maxBytes} byte limit`);
    this.name = 'DocumentTooLargeError';
  }
}

export class DocumentTypeNotAllowedError extends Error {
  constructor(mimeType: string) {
    super(`Document type '${mimeType}' is not permitted`);
    this.name = 'DocumentTypeNotAllowedError';
  }
}

/** The malware check rejected the upload; its metadata is kept, its content never written (ADR-030). */
export class DocumentRejectedError extends Error {
  constructor(public readonly documentId: string, public readonly checksumSha256: string) {
    super('This file was rejected by the malware check. If it is password-protected or contains macros, save a copy without them and upload it again.');
    this.name = 'DocumentRejectedError';
  }
}

/** The document has not passed the malware check, so it is not served (ADR-030). */
export class DocumentNotAvailableError extends Error {
  constructor(public readonly documentId: string, public readonly reason: 'pending-scan' | 'infected') {
    super('This document has not passed the malware check and cannot be downloaded.');
    this.name = 'DocumentNotAvailableError';
  }
}

export interface DocumentStorageAdapter {
  /** Stores only an upload the document store scanned (or marked system content); anything else is a TypeError. */
  store(upload: ScannedUpload): Promise<StoredDocument>;
  retrieve(tenantId: string, documentId: string, actorId: string): Promise<RetrievedDocument>;
  getMetadata(tenantId: string, documentId: string): Promise<DocumentMetadata>;
  softDelete(tenantId: string, documentId: string, actorId: string, reason: string): Promise<void>;
  listByOwner(tenantId: string, ownerService: string, ownerRef: string): Promise<DocumentMetadata[]>;
}
