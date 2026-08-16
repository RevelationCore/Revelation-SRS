/**
 * Virus/malware scanning seam. This package ships only `NoopScanner` — a
 * production deployment accepting real end-user uploads (DSA medical
 * evidence, assessor reports, etc.) MUST provide a real implementation
 * (e.g. a ClamAV daemon client) before going live. `NoopScanner` marks
 * every upload 'clean' immediately; it exists so the storage adapter has
 * something to call, not as a claim that scanning happens.
 */
export type ScanResult = 'clean' | 'infected';

export interface DocumentScanner {
  scan(content: Buffer): Promise<ScanResult>;
}

export class NoopScanner implements DocumentScanner {
  // eslint-disable-next-line @typescript-eslint/require-await
  async scan(_content: Buffer): Promise<ScanResult> {
    return 'clean';
  }
}
