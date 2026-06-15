/**
 * EDRMS (Electronic Document and Records Management System) adapter.
 *
 * The adapter interface is implemented by:
 *  - EdrmsSimulator  — returns a synthetic reference; used in development and tests
 *  - EdrmsRestClient — calls the institutional EDRMS REST API (future Stage 7)
 *
 * Document binaries are never stored in the Wellbeing database.  Only the
 * reference, type, and status metadata are stored in evidence_reference rows.
 */

export interface DocumentMetadata {
  evidenceTypeCode: string;
  filename:         string;
  contentType:      string;
  uploadedBy:       string;
}

export interface DocumentRegistration {
  documentRef: string;
  documentUrl: string;
}

export interface EdrmsAdapter {
  /**
   * Register a document with the EDRMS and return its permanent reference.
   * In production the caller has already uploaded the binary to the EDRMS;
   * this call records metadata and obtains a stable reference URI.
   */
  registerDocument(
    tenantId: string,
    caseId:   string,
    meta:     DocumentMetadata,
  ): Promise<DocumentRegistration>;
}

/**
 * Simulator — used in development and tests.
 *
 * Returns deterministic-looking synthetic references without any external I/O.
 * Inject this via EdrmsAdapter in app.ts when EDRMS_URL is not configured.
 */
export class EdrmsSimulator implements EdrmsAdapter {
  async registerDocument(
    tenantId: string,
    caseId:   string,
    meta:     DocumentMetadata,
  ): Promise<DocumentRegistration> {
    const suffix = Math.random().toString(36).slice(2, 10);
    const ref    = `sim-doc-${suffix}`;
    return {
      documentRef: ref,
      documentUrl: `http://edrms-simulator.local/documents/${tenantId}/${caseId}/${ref}`,
    };
  }
}
