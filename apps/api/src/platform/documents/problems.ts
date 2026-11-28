import {
  DocumentNotAvailableError,
  DocumentRejectedError,
  DocumentScannerUnavailableError,
  DocumentTooLargeError,
  DocumentTypeNotAllowedError,
} from '@revelation-srs/documents';

/** How a document-store error is shown (ADR-030 item 4); null for any other error. Shared by core and wellbeing wording. */
export function documentProblem(err: unknown): { status: number; type: string; title: string; detail: string; retryAfter?: number } | null {
  if (err instanceof DocumentRejectedError) {
    return { status: 422, type: 'document-rejected', title: 'File rejected', detail: err.message };
  }
  if (err instanceof DocumentScannerUnavailableError) {
    return err.cause === 'disabled'
      ? { status: 503, type: 'scanner-unavailable', title: 'Uploads unavailable', detail: 'Uploads are not available in this environment.' }
      : { status: 503, type: 'scanner-unavailable', title: 'Uploads unavailable', detail: 'Uploads are temporarily unavailable. Try again in a few minutes.', retryAfter: 60 };
  }
  if (err instanceof DocumentNotAvailableError) {
    return { status: 409, type: 'document-not-available', title: 'Document not available', detail: err.message };
  }
  if (err instanceof DocumentTooLargeError || err instanceof DocumentTypeNotAllowedError) {
    return { status: 422, type: 'validation-error', title: err.message, detail: err.message };
  }
  return null;
}
