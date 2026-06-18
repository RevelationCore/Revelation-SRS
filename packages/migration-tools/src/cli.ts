#!/usr/bin/env node
/**
 * Migration CLI — import historical SRS data from SITS-style or Banner-style exports.
 *
 * Usage:
 *   node src/cli.ts import --source sits|banner --file <path> --tenant-id <uuid> [--dry-run]
 *   node src/cli.ts validate --source sits|banner --file <path> --tenant-id <uuid>
 *
 * Environment:
 *   DATABASE_URL  PostgreSQL connection string (required)
 */

import { readFile } from 'node:fs/promises';
import { createDb } from '@revelation-srs/db';
import { mapSitsToImportPayload } from './mappings/sits.js';
import { mapBannerToImportPayload } from './mappings/banner.js';
import type { ImportPayload } from './contracts/payload.js';
import { validatePayload } from './validation/index.js';
import { runImport } from './importer/index.js';

type SourceSystem = 'sits' | 'banner' | 'raw';

interface CliArgs {
  command:  'import' | 'validate';
  source:   SourceSystem;
  file:     string;
  tenantId: string;
  dryRun:   boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args = argv.slice(2);
  const command = (args[0] ?? 'import') as CliArgs['command'];

  function flag(name: string): string | undefined {
    const idx = args.indexOf(`--${name}`);
    return idx >= 0 ? args[idx + 1] : undefined;
  }

  const source = (flag('source') ?? 'raw') as SourceSystem;
  const file = flag('file');
  const tenantId = flag('tenant-id');
  const dryRun = args.includes('--dry-run');

  if (!file)     throw new Error('--file is required');
  if (!tenantId) throw new Error('--tenant-id is required');

  return { command, source, file, tenantId, dryRun };
}

async function loadPayload(args: CliArgs): Promise<ImportPayload> {
  const raw = JSON.parse(await readFile(args.file, 'utf8')) as unknown;

  switch (args.source) {
    case 'sits':
      return mapSitsToImportPayload(raw as Parameters<typeof mapSitsToImportPayload>[0]);
    case 'banner':
      return mapBannerToImportPayload(raw as Parameters<typeof mapBannerToImportPayload>[0]);
    case 'raw':
      return raw as ImportPayload;
    default:
      throw new Error(`Unknown source system: ${args.source as string}`);
  }
}

function printReport(report: ReturnType<typeof validatePayload>): void {
  console.log('\n── Migration Report ─────────────────────────────────────────────────────────');
  console.log(`  Source:    ${report.sourceSystem}`);
  console.log(`  Tenant:    ${report.tenantId}`);
  console.log(`  Dry run:   ${report.dryRun}`);
  console.log(`  Timestamp: ${report.timestamp}`);

  console.log('\n  Record counts:');
  for (const c of report.recordCounts) {
    if (c.source > 0) {
      console.log(`    ${c.entity.padEnd(24)} source=${c.source}  loaded=${c.loaded}  failed=${c.failed}`);
    }
  }

  if (report.issues.length > 0) {
    console.log('\n  Issues:');
    for (const issue of report.issues) {
      const prefix = issue.severity === 'error' ? '  ✗' : issue.severity === 'warning' ? '  ⚠' : '  ℹ';
      const loc = issue.externalId ? ` [${issue.externalId}]` : '';
      console.log(`  ${prefix} ${issue.entity}${loc}: ${issue.message}`);
    }
  }

  console.log(`\n  Summary: ${report.summary.errorCount} error(s), ${report.summary.warningCount} warning(s), ${report.summary.infoCount} info`);

  if (report.summary.hasErrors) {
    console.log('  STATUS: FAILED — import was not applied (errors must be resolved first)');
  } else {
    console.log('  STATUS: OK');
  }
  console.log('────────────────────────────────────────────────────────────────────────────\n');
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  const payload = await loadPayload(args);

  if (args.command === 'validate') {
    const report = validatePayload(payload, args.tenantId, true);
    printReport(report);
    process.exit(report.summary.hasErrors ? 1 : 0);
  }

  // import command
  const databaseUrl = process.env['DATABASE_URL'];
  if (!databaseUrl) throw new Error('DATABASE_URL environment variable is required');

  const db = createDb(databaseUrl);

  const result = await runImport(db, payload, {
    dryRun:   args.dryRun,
    tenantId: args.tenantId,
  });

  printReport(result.report);

  if (args.dryRun) {
    console.log('Dry run complete — no data was written.');
  } else if (!result.report.summary.hasErrors) {
    console.log(`Import complete. ${result.idMap?.size() ?? 0} IDs mapped.`);
  }

  process.exit(result.report.summary.hasErrors ? 1 : 0);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
