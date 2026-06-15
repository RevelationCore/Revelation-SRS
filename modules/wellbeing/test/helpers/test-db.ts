import { createHmac } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { sql } from 'drizzle-orm';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';

import { buildApp, type AppOptions } from '../../src/app.js';
import type { Config } from '../../src/config.js';
import { createWellbeingDb, type WellbeingDb } from '../../src/db/client.js';

const JWT_SECRET = 'test-secret-wellbeing';

export interface TestWellbeingApp {
  app:          Awaited<ReturnType<typeof buildApp>>;
  container:    StartedPostgreSqlContainer;
  db:           WellbeingDb;
  tenantId:     string;
  secondTenantId: string;
  teardown:     () => Promise<void>;
  makeJwt:      (opts?: { sub?: string; roles?: string[]; tenantId?: string }) => string;
}

const __dirname = dirname(fileURLToPath(import.meta.url));

async function applySql(db: WellbeingDb, absolutePath: string): Promise<void> {
  const content = await readFile(absolutePath, 'utf8');
  await db.execute(sql.raw(content));
}

/** Start a throw-away Wellbeing service backed by a fresh Testcontainers PostgreSQL. */
export async function startTestApp(appOpts: AppOptions = {}): Promise<TestWellbeingApp> {
  const container = await new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase('wellbeing_test')
    .start();

  const connectionString = container.getConnectionUri();
  const db = createWellbeingDb(connectionString);

  // Apply the core platform migration first (creates the tenant table which
  // wellbeing tables reference via FOREIGN KEY).
  const coreMigrationsDir = join(__dirname, '../../../../packages/db/migrations');
  await applySql(db, join(coreMigrationsDir, '0000_initial_platform_schema.sql'));

  // Apply wellbeing module migrations in order
  const wellbeingMigrationsDir = join(__dirname, '../../migrations');
  await applySql(db, join(wellbeingMigrationsDir, '0001_wellbeing_initial.sql'));
  await applySql(db, join(wellbeingMigrationsDir, '0002_wellbeing_event_log.sql'));
  await applySql(db, join(wellbeingMigrationsDir, '0003_wellbeing_audit_log.sql'));
  await applySql(db, join(wellbeingMigrationsDir, '0004_wellbeing_adjustment_workflow.sql'));
  await applySql(db, join(wellbeingMigrationsDir, '0005_wellbeing_ec_workflow.sql'));
  await applySql(db, join(wellbeingMigrationsDir, '0006_wellbeing_mh_session_notes.sql'));
  await applySql(db, join(wellbeingMigrationsDir, '0007_wellbeing_retention_sar.sql'));

  // Seed test tenants
  const tenantId       = '00000000-0000-0000-0000-000000000001';
  const secondTenantId = '00000000-0000-0000-0000-000000000002';

  await db.execute(sql`
    INSERT INTO tenant (id, code, name, active)
    VALUES
      (${tenantId},       'TEST',  'Test University',        true),
      (${secondTenantId}, 'TEST2', 'Second Test University', true)
  `);

  const config: Config = {
    port:            3001,
    logLevel:        'silent',
    nodeEnv:         'test',
    databaseUrl:     connectionString,
    srsApiUrl:       'http://localhost:3000',
    natsUrl:         'nats://localhost:4222',  // NATS not running in tests
    jwtSecret:       JWT_SECRET,
    keycloakJwksUrl: undefined,
    corsOrigins:     ['http://localhost:5173'],
  };

  const app = await buildApp(config, appOpts);
  await app.ready();

  const makeJwt = (opts: { sub?: string; roles?: string[]; tenantId?: string } = {}): string => {
    const header  = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({
      sub:                opts.sub ?? 'test-advisor-001',
      tenant_id:          opts.tenantId ?? tenantId,
      realm_roles:        opts.roles ?? ['wellbeing-advisor'],
      name:               'Test Advisor',
      email:              'advisor@test.university.ac.uk',
      preferred_username: 'test.advisor',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
    })).toString('base64url');
    const signingInput = `${header}.${payload}`;
    const sig = createHmac('sha256', JWT_SECRET).update(signingInput).digest('base64url');
    return `${signingInput}.${sig}`;
  };

  const teardown = async (): Promise<void> => {
    await app.close();
    await container.stop();
  };

  return { app, container, db, tenantId, secondTenantId, teardown, makeJwt };
}
