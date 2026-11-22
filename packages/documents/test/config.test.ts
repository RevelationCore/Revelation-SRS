/** ADR-030 guard: the scanner configuration and its start-up refusal (P-05). */
import { describe, expect, it } from 'vitest';

import { assertDocumentScannerConfig, ClamdScanner, createDocumentScanner, loadDocumentScannerConfig, NoopScanner, RejectingScanner } from '../src/index.js';

describe('document scanner configuration', () => {
  it('defaults to clamd, never to the no-op scanner', () => {
    expect(loadDocumentScannerConfig({})).toMatchObject({ mode: 'clamd', clamdPort: 3310, timeoutMs: 30_000, maxConcurrency: 4 });
  });

  it('refuses an unknown mode in every environment', () => {
    expect(() => loadDocumentScannerConfig({ DOCUMENT_SCANNER: 'off' })).toThrow(/must be clamd, noop or reject/);
  });

  it('refuses noop, and clamd without CLAMD_HOST, outside development and test', () => {
    for (const env of ['production', 'staging']) {
      expect(() => assertDocumentScannerConfig('srs-api', env, loadDocumentScannerConfig({ DOCUMENT_SCANNER: 'noop' }))).toThrow(/Refusing to start srs-api .*noop/);
      expect(() => assertDocumentScannerConfig('srs-api', env, loadDocumentScannerConfig({}))).toThrow(/CLAMD_HOST is not set/);
      expect(() => assertDocumentScannerConfig('srs-api', env, loadDocumentScannerConfig({ CLAMD_HOST: 'srs-clamav' }))).not.toThrow();
      expect(() => assertDocumentScannerConfig('srs-api', env, loadDocumentScannerConfig({ DOCUMENT_SCANNER: 'reject' }))).not.toThrow();
      expect(() => createDocumentScanner(env, loadDocumentScannerConfig({ DOCUMENT_SCANNER: 'noop' }))).toThrow(/development and test only/);
    }
    expect(() => assertDocumentScannerConfig('srs-api', 'development', loadDocumentScannerConfig({ DOCUMENT_SCANNER: 'noop' }))).not.toThrow();
  });

  it('builds the scanner the mode names', () => {
    expect(createDocumentScanner('test', loadDocumentScannerConfig({ DOCUMENT_SCANNER: 'noop' }))).toBeInstanceOf(NoopScanner);
    expect(createDocumentScanner('production', loadDocumentScannerConfig({ DOCUMENT_SCANNER: 'reject' }))).toBeInstanceOf(RejectingScanner);
    expect(createDocumentScanner('production', loadDocumentScannerConfig({ CLAMD_HOST: 'srs-clamav' }))).toBeInstanceOf(ClamdScanner);
  });
});
