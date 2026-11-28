import type { StoreDocumentInput } from './adapter.js';
import type { ScanVerdict } from './scanner.js';

/**
 * An upload the document store has scanned, or marked as system content
 * (ADR-030 item 2). Only the store makes one; it records each in a
 * module-private WeakSet, so neither an object literal nor a cast passes.
 */
export interface ScannedUpload {
  readonly input:          StoreDocumentInput;
  readonly checksumSha256: string;
  /** null for system-generated content, which is not scanned. */
  readonly verdict:        Extract<ScanVerdict, { verdict: 'clean' }> | null;
  readonly scannedAt:      Date | null;
}

const issued = new WeakSet<object>();

export function issue(upload: ScannedUpload): ScannedUpload {
  const frozen = Object.freeze({ ...upload });
  issued.add(frozen);
  return frozen;
}

export function assertIssued(upload: unknown): asserts upload is ScannedUpload {
  if (typeof upload !== 'object' || upload === null || !issued.has(upload)) {
    throw new TypeError('store() accepts only an upload the document store scanned (ADR-030): call documentStore.scanUpload first');
  }
}
