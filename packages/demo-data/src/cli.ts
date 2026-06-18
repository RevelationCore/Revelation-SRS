import { parseArgs } from 'node:util';

import { eq, and } from 'drizzle-orm';
import { createDb, tenants, demoStatus } from '@revelation-srs/db';

import { listManifests, SCENARIO_REGISTRY } from './manifest.js';
import { resetScenario } from './reset.js';
import { runRotation } from './rotation.js';
import { validateScenario } from './validate.js';
import { assertSchemaVersion, SafetyError } from './safety.js';

function requireDatabaseUrl(): string {
  const url = process.env['DATABASE_URL'];
  if (!url) {
    console.error('Error: DATABASE_URL environment variable is not set.');
    process.exit(1);
  }
  return url;
}

async function resolveTenantId(
  databaseUrl: string,
  tenantId: string | undefined,
  tenantCode: string | undefined,
): Promise<string> {
  if (tenantId) return tenantId;

  if (!tenantCode) {
    console.error('Error: --tenant-id or --tenant-code is required.');
    process.exit(1);
  }

  const db = createDb(databaseUrl);
  const rows = await db
    .select({ id: tenants.id })
    .from(tenants)
    .where(and(eq(tenants.code, tenantCode), eq(tenants.demoMode, true)))
    .limit(1);

  const row = rows[0];
  if (!row) {
    console.error(
      `Error: No demo tenant found with code "${tenantCode}". ` +
      'Ensure the tenant exists and has demo_mode = true.',
    );
    process.exit(1);
  }

  return row.id;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}min`;
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/require-await
async function cmdList(): Promise<void> {
  const entries = listManifests();
  if (entries.length === 0) {
    console.log('No scenarios registered.');
    return;
  }

  console.log('\nRegistered demo scenarios:\n');
  const rows = entries.map(e => ({
    slug:          e.manifest.slug,
    class:         e.class,
    schemaVersion: e.manifest.schemaVersion,
    referenceDate: e.manifest.referenceDate,
    students:      e.manifest.targetVolumes['students'] ?? '—',
    budget:        formatDuration(e.manifest.loadTimeBudgetMs),
  }));
  console.table(rows);
}

async function cmdReset(args: Record<string, string | boolean | string[] | undefined>): Promise<void> {
  const databaseUrl = requireDatabaseUrl();
  const scenario    = args['scenario'];
  const dryRun      = args['dry-run'] === true;

  if (typeof scenario !== 'string' || !scenario) {
    console.error('Error: --scenario <slug> is required.');
    process.exit(1);
  }

  const tenantId = await resolveTenantId(
    databaseUrl,
    typeof args['tenant-id'] === 'string' ? args['tenant-id'] : undefined,
    typeof args['tenant-code'] === 'string' ? args['tenant-code'] : undefined,
  );

  await resetScenario({ databaseUrl, tenantId, scenarioSlug: scenario, dryRun });
}

async function cmdValidate(args: Record<string, string | boolean | string[] | undefined>): Promise<void> {
  const databaseUrl = requireDatabaseUrl();
  const scenario    = args['scenario'];

  if (typeof scenario !== 'string' || !scenario) {
    console.error('Error: --scenario <slug> is required.');
    process.exit(1);
  }

  const entry = SCENARIO_REGISTRY.get(scenario);
  if (!entry) {
    console.error(`Error: Unknown scenario "${scenario}". Run pnpm demo:list for valid slugs.`);
    process.exit(1);
  }

  const tenantId = await resolveTenantId(
    databaseUrl,
    typeof args['tenant-id'] === 'string' ? args['tenant-id'] : undefined,
    typeof args['tenant-code'] === 'string' ? args['tenant-code'] : undefined,
  );

  const db = createDb(databaseUrl);
  const result = await validateScenario(db, tenantId, entry.manifest);

  console.log(`\nValidation complete for "${scenario}":`);
  console.log(`  Passed: ${result.passed}`);
  console.log(`  Failed: ${result.failed}`);
  if (result.issues.length > 0) {
    console.log('  Issues:');
    for (const issue of result.issues) {
      console.log(`    - ${issue}`);
    }
  }

  if (result.failed > 0) process.exit(1);
}

async function cmdStatus(): Promise<void> {
  const databaseUrl = requireDatabaseUrl();
  const db = createDb(databaseUrl);

  const rows = await db
    .select({
      scenarioSlug:  demoStatus.scenarioSlug,
      scenarioName:  demoStatus.scenarioName,
      schemaVersion: demoStatus.schemaVersion,
      referenceDate: demoStatus.referenceDate,
      clockOffsetMs: demoStatus.clockOffsetMs,
      loadedAt:      demoStatus.loadedAt,
      nextResetAt:   demoStatus.nextResetAt,
    })
    .from(demoStatus)
    .innerJoin(tenants, eq(demoStatus.tenantId, tenants.id))
    .where(eq(tenants.demoMode, true));

  if (rows.length === 0) {
    console.log('\nNo demo scenario is currently loaded.');
    return;
  }

  console.log('\nDemo scenario status:\n');
  for (const row of rows) {
    const demoNow = new Date(Date.now() + row.clockOffsetMs);
    console.log(`  Scenario:       ${row.scenarioName} (${row.scenarioSlug})`);
    console.log(`  Schema version: ${row.schemaVersion}`);
    console.log(`  Reference date: ${row.referenceDate}`);
    console.log(`  Demo time now:  ${demoNow.toISOString()}`);
    console.log(`  Loaded at:      ${row.loadedAt.toISOString()}`);
    console.log(`  Next reset:     ${row.nextResetAt?.toISOString() ?? 'not scheduled'}`);
    console.log();
  }
}

async function cmdCheckVersions(): Promise<void> {
  const databaseUrl = requireDatabaseUrl();
  const db = createDb(databaseUrl);
  const entries = listManifests();

  let anyFailed = false;
  console.log('\nChecking scenario schema versions:\n');

  for (const entry of entries) {
    try {
      await assertSchemaVersion(db, entry.manifest.schemaVersion);
      console.log(`  ✓ ${entry.manifest.slug} (requires ${entry.manifest.schemaVersion})`);
    } catch (err) {
      const msg = err instanceof SafetyError ? err.message : String(err);
      console.log(`  ✗ ${entry.manifest.slug} (requires ${entry.manifest.schemaVersion}): ${msg}`);
      anyFailed = true;
    }
  }

  console.log();
  if (anyFailed) {
    console.error('One or more scenarios are incompatible with the current database schema.');
    process.exit(1);
  }

  console.log('All scenarios are compatible with the current database schema.');
}

async function cmdRotate(
  args: Record<string, string | boolean | string[] | undefined>,
  rawMode: string,
): Promise<void> {
  const databaseUrl = requireDatabaseUrl();

  if (rawMode !== 'daily' && rawMode !== 'weekly') {
    console.error('Error: rotate requires a mode argument: "daily" or "weekly".');
    console.error('  Usage: demo-data rotate daily [--dry-run] [--tenant-id <id>]');
    console.error('         demo-data rotate weekly [--dry-run] [--tenant-id <id>]');
    process.exit(1);
  }

  const mode   = rawMode;
  const dryRun = args['dry-run'] === true;

  // --force-scenario CLI flag sets the env var so rotation.ts reads it.
  const forceScenario = typeof args['force-scenario'] === 'string' ? args['force-scenario'] : undefined;
  if (forceScenario) {
    process.env['DEMO_FORCE_SCENARIO'] = forceScenario;
  }

  const tenantId = await resolveTenantId(
    databaseUrl,
    typeof args['tenant-id'] === 'string' ? args['tenant-id'] : undefined,
    typeof args['tenant-code'] === 'string' ? args['tenant-code'] : undefined,
  );

  const result = await runRotation({ databaseUrl, tenantId, mode, dryRun });

  if (result.skipped) {
    console.log(`\nRotation skipped: ${result.skipReason ?? 'unknown'}`);
  } else if (result.dryRun) {
    console.log(`\nDry run complete — would have loaded: ${result.scenario}`);
  } else {
    console.log(`\nRotation complete — loaded: ${result.scenario}`);
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  options: {
    scenario:         { type: 'string' },
    'tenant-id':      { type: 'string' },
    'tenant-code':    { type: 'string' },
    'dry-run':        { type: 'boolean' },
    'force-scenario': { type: 'string' },
  },
  allowPositionals: true,
  strict: false,
});

const command = positionals[0];

const handlers: Record<string, () => Promise<void>> = {
  list:             () => cmdList(),
  reset:            () => cmdReset(values),
  validate:         () => cmdValidate(values),
  status:           () => cmdStatus(),
  'check-versions': () => cmdCheckVersions(),
  rotate:           () => cmdRotate(values, positionals[1] ?? ''),
};

if (!command || !(command in handlers)) {
  console.error(`Usage: demo-data <command> [options]`);
  console.error(`Commands: ${Object.keys(handlers).join(', ')}`);
  process.exit(1);
}

const handler = handlers[command];
if (handler) {
  handler().catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`\nError: ${msg}`);
    process.exit(1);
  });
}
