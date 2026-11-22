// One-off rescan of documents stored before malware scanning (ADR-030 item 11).
// Runs in srs-worker. Core rescans every owner except the wellbeing service,
// which rescans its own (modules/wellbeing/src/rescan-documents.ts).
//
//   node dist/rescan-documents.js --tenant <uuid> [--tenant <uuid> …] | --all-tenants
//
// Idempotent. Exits non-zero if any document could not be scanned; those stay
// pending-scan (refused on download) and a later run retries them.
import { assertDocumentScannerConfig, createDocumentScanner, loadDocumentScannerConfig } from '@revelation-srs/documents';
import { createDb, tenants } from '@revelation-srs/db';
import { pino } from 'pino';

import { loadConfig } from './config.js';
import { createApiDocumentStore } from './platform/documents/document-store.js';

const args = process.argv.slice(2);
const named = args.flatMap((a, i) => (a === '--tenant' && args[i + 1] ? [args[i + 1]!] : []));
if (named.length === 0 && !args.includes('--all-tenants')) {
  console.error('rescan-documents: name --tenant <uuid> (repeatable) or --all-tenants');
  process.exit(2);
}

const config = loadConfig();
const scannerConfig = config.documentScanner ?? loadDocumentScannerConfig();
assertDocumentScannerConfig('srs-worker rescan', config.nodeEnv, scannerConfig);
const log = pino({ level: config.logLevel });
const db = createDb(config.databaseUrl, { statementTimeoutMs: 300_000 });
const store = createApiDocumentStore(db, createDocumentScanner(config.nodeEnv, scannerConfig), log);

const tenantIds = named.length > 0 ? named : (await db.select({ id: tenants.id }).from(tenants)).map((t) => t.id);
let failed = 0;
for (const tenantId of tenantIds) {
  const summary = await store.rescanPending(tenantId, { excludeOwnerServices: ['wellbeing'] });
  failed += summary.failed;
  log.info({ event: 'documents.rescan.summary', tenantId, ...summary }, 'Rescanned documents stored before scanning');
}
await db.$client.end();
process.exit(failed > 0 ? 1 : 0);
