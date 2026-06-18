import type { createDb} from '@revelation-srs/db';
import { tenants, deploymentEnvironments } from '@revelation-srs/db';
import { eq, and, sql } from 'drizzle-orm';

type Db = ReturnType<typeof createDb>;

export class SafetyError extends Error {
  gate: string;

  constructor(gate: string, message: string) {
    super(message);
    this.name = 'SafetyError';
    this.gate = gate;
  }
}

export async function assertResetAllowed(db: Db, tenantId: string): Promise<void> {
  // Gate 1: DEMO_DATA_ENABLED must be 'true'
  if (process.env['DEMO_DATA_ENABLED'] !== 'true') {
    throw new SafetyError(
      'DEMO_DATA_ENABLED',
      'DEMO_DATA_ENABLED env var must be set to "true" to use demo data tooling.',
    );
  }

  // Gate 2: DEMO_RESET_ALLOWED must be 'true'
  if (process.env['DEMO_RESET_ALLOWED'] !== 'true') {
    throw new SafetyError(
      'DEMO_RESET_ALLOWED',
      'DEMO_RESET_ALLOWED env var must be set to "true" to perform a demo reset.',
    );
  }

  // Gate 3: Tenant must exist and have demo_mode=true
  const rows = await db
    .select({ id: tenants.id, demoMode: tenants.demoMode })
    .from(tenants)
    .where(and(eq(tenants.id, tenantId), eq(tenants.demoMode, true)))
    .limit(1);

  if (rows.length === 0) {
    throw new SafetyError(
      'TENANT_DEMO_MODE',
      `Tenant "${tenantId}" does not exist or does not have demo_mode=true.`,
    );
  }

  // Gate 4: DEMO_DB_ALLOWLIST — if set, DATABASE_URL hostname must be in the list
  const allowlist = process.env['DEMO_DB_ALLOWLIST'];
  if (allowlist !== undefined && allowlist.trim() !== '') {
    const databaseUrl = process.env['DATABASE_URL'] ?? '';
    let hostname = '';
    try {
      hostname = new URL(databaseUrl).hostname;
    } catch {
      throw new SafetyError(
        'DEMO_DB_ALLOWLIST',
        'Could not parse DATABASE_URL to extract hostname for allowlist check.',
      );
    }
    const allowed = allowlist.split(',').map((h: string) => h.trim());
    if (!allowed.includes(hostname)) {
      throw new SafetyError(
        'DEMO_DB_ALLOWLIST',
        `Database hostname "${hostname}" is not in DEMO_DB_ALLOWLIST. Refusing demo reset.`,
      );
    }
  }

  // Gate 5: No production-like deployment environments may be active
  const prodEnvs = await db
    .select({ id: deploymentEnvironments.id, environmentCode: deploymentEnvironments.environmentCode })
    .from(deploymentEnvironments)
    .where(and(eq(deploymentEnvironments.productionLike, true), eq(deploymentEnvironments.active, true)));

  if (prodEnvs.length > 0) {
    const codes = prodEnvs.map(e => e.environmentCode).join(', ');
    throw new SafetyError(
      'PRODUCTION_LIKE_ENVIRONMENTS',
      `Cannot run demo reset: production-like deployment environments are active (${codes}). ` +
      'Demo data tooling must not run on a server with production-like environments configured.',
    );
  }
}

export async function assertSchemaVersion(db: Db, requiredVersion: string): Promise<void> {
  // Detect current schema level by probing information_schema
  const demoStatusExists = await db.execute(sql`
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name   = 'demo_status'
    LIMIT 1
  `);

  let currentLevel: number;

  if (demoStatusExists.length > 0) {
    // demo_status table present → at least schema version 0023
    currentLevel = 23;
  } else {
    // Check whether demo_mode column exists on the tenant table
    const demoModeExists = await db.execute(sql`
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name   = 'tenant'
        AND column_name  = 'demo_mode'
      LIMIT 1
    `);

    if (demoModeExists.length > 0) {
      // demo_mode column present → at least schema version 0022
      currentLevel = 22;
    } else {
      currentLevel = 0;
    }
  }

  const requiredLevel = parseInt(requiredVersion, 10);
  if (isNaN(requiredLevel)) {
    throw new SafetyError(
      'SCHEMA_VERSION_PARSE',
      `Cannot parse required schema version: "${requiredVersion}".`,
    );
  }

  if (requiredLevel > currentLevel) {
    throw new SafetyError(
      'SCHEMA_VERSION',
      `Schema version ${requiredVersion} is required but detected level is ${String(currentLevel).padStart(4, '0')}. ` +
      'Run database migrations before loading demo data.',
    );
  }
}
