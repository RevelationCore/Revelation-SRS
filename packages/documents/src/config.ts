import { ClamdScanner } from './clamd-scanner.js';
import { NoopScanner, RejectingScanner, type DocumentScanner } from './scanner.js';

/** ADR-030 item 7: which scanner a service uses. The default is the real one. */
export interface DocumentScannerConfig {
  mode:           'clamd' | 'noop' | 'reject';
  clamdHost?:     string | undefined;
  clamdPort:      number;
  timeoutMs:      number;
  maxConcurrency: number;
}

const isDevOrTest = (nodeEnv: string) => nodeEnv === 'development' || nodeEnv === 'test';

export function loadDocumentScannerConfig(env: NodeJS.ProcessEnv = process.env): DocumentScannerConfig {
  const mode = env['DOCUMENT_SCANNER'] ?? 'clamd';
  if (mode !== 'clamd' && mode !== 'noop' && mode !== 'reject') {
    throw new Error(`DOCUMENT_SCANNER must be clamd, noop or reject, not '${mode}'`);
  }
  const optionalInt = (name: string, fallback: number) => {
    const v = env[name];
    if (!v) return fallback;
    const n = Number(v);
    if (!Number.isInteger(n) || n <= 0) throw new Error(`${name} must be a positive integer, not '${v}'`);
    return n;
  };
  return {
    mode,
    clamdHost:      env['CLAMD_HOST'] || undefined,
    clamdPort:      optionalInt('CLAMD_PORT', 3310),
    timeoutMs:      optionalInt('DOCUMENT_SCAN_TIMEOUT_MS', 30_000),
    maxConcurrency: optionalInt('DOCUMENT_SCAN_MAX_CONCURRENCY', 4),
  };
}

/**
 * Refuses, outside development and test, a configuration under which uploads
 * would not be scanned (P-05). Static: clamd is not contacted, so its outage
 * blocks uploads only and cannot crash-loop the service.
 */
export function assertDocumentScannerConfig(service: string, nodeEnv: string, cfg: DocumentScannerConfig): void {
  if (isDevOrTest(nodeEnv)) return;
  const problems: string[] = [];
  if (cfg.mode === 'noop') problems.push('DOCUMENT_SCANNER=noop is for development and test only');
  if (cfg.mode === 'clamd' && !cfg.clamdHost) problems.push('CLAMD_HOST is not set');
  if (problems.length > 0) throw new Error(`Refusing to start ${service} in '${nodeEnv}' (ADR-030): ${problems.join('; ')}`);
}

export function createDocumentScanner(nodeEnv: string, cfg: DocumentScannerConfig): DocumentScanner {
  switch (cfg.mode) {
    case 'noop':
      if (!isDevOrTest(nodeEnv)) throw new Error('The no-op document scanner is for development and test only (ADR-030)');
      return new NoopScanner();
    case 'reject':
      return new RejectingScanner();
    case 'clamd':
      if (!cfg.clamdHost) throw new Error('CLAMD_HOST is not set (ADR-030)');
      return new ClamdScanner({ host: cfg.clamdHost, port: cfg.clamdPort, timeoutMs: cfg.timeoutMs, maxConcurrency: cfg.maxConcurrency });
  }
}
