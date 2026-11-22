/**
 * Malware scanning (ADR-030). Every upload is scanned before it is stored,
 * and a document that has not passed is never served. A scanner either
 * gives a verdict or throws DocumentScannerUnavailableError; there is no
 * "unknown means clean".
 */
export type ScanVerdict =
  | { verdict: 'clean';    engine: string; databaseVersion: string | null }
  | { verdict: 'infected'; engine: string; databaseVersion: string | null; signature: string };

export interface DocumentScanner {
  /** 'clamav' | 'noop' | 'reject' */
  readonly engine: string;
  scan(content: Buffer, signal: AbortSignal): Promise<ScanVerdict>;
}

export type ScannerUnavailableCause = 'timeout' | 'connection' | 'protocol' | 'disabled';

/** The scanner could not give a verdict: the upload is refused (fail closed). */
export class DocumentScannerUnavailableError extends Error {
  constructor(public override readonly cause: ScannerUnavailableCause, detail?: string) {
    super(`Document scanner unavailable (${cause})${detail ? `: ${detail}` : ''}`);
    this.name = 'DocumentScannerUnavailableError';
  }
}

/**
 * Marks everything clean. Development and test only: createDocumentScanner
 * and assertDocumentScannerConfig refuse it elsewhere, and lint bans
 * importing it outside this package and tests.
 */
export class NoopScanner implements DocumentScanner {
  readonly engine = 'noop';
  // eslint-disable-next-line @typescript-eslint/require-await
  async scan(_content: Buffer, _signal: AbortSignal): Promise<ScanVerdict> {
    return { verdict: 'clean', engine: this.engine, databaseVersion: null };
  }
}

/** Refuses every upload: for an environment that cannot run a scanner. Never stores unscanned content. */
export class RejectingScanner implements DocumentScanner {
  readonly engine = 'reject';
  // eslint-disable-next-line @typescript-eslint/require-await
  async scan(_content: Buffer, _signal: AbortSignal): Promise<ScanVerdict> {
    throw new DocumentScannerUnavailableError('disabled');
  }
}
