import { createHmac } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { sql } from 'drizzle-orm';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';

import { buildApp, type AppOptions } from '../../src/app.js';
import type { Config } from '../../src/config.js';
import { createAttendanceDb, type AttendanceDb } from '../../src/db/client.js';

const JWT_SECRET = 'test-secret-attendance';

export interface TestAttendanceApp {
  app:            Awaited<ReturnType<typeof buildApp>>;
  container:      StartedPostgreSqlContainer;
  db:             AttendanceDb;
  tenantId:       string;
  secondTenantId: string;
  teardown:       () => Promise<void>;
  makeJwt:        (opts?: { sub?: string; roles?: string[]; tenantId?: string }) => string;
}

const __dirname = dirname(fileURLToPath(import.meta.url));

async function applySql(db: AttendanceDb, absolutePath: string): Promise<void> {
  const content = await readFile(absolutePath, 'utf8');
  await db.execute(sql.raw(content));
}

/** Start a throw-away Attendance service backed by a fresh Testcontainers PostgreSQL. */
export async function startTestApp(appOpts: AppOptions = {}): Promise<TestAttendanceApp> {
  const container = await new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase('attendance_test')
    .start();

  const connectionString = container.getConnectionUri();
  const db = createAttendanceDb(connectionString);

  // Apply the core platform migration first (creates the tenant table which
  // attendance tables reference via FOREIGN KEY).
  const coreMigrationsDir = join(__dirname, '../../../../packages/db/migrations');
  await applySql(db, join(coreMigrationsDir, '0000_platform_foundations.sql'));

  // Apply attendance module migrations in order
  const attendanceMigrationsDir = join(__dirname, '../../migrations');
  await applySql(db, join(attendanceMigrationsDir, '0001_attendance_initial.sql'));

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
    port:            3011,
    logLevel:        'silent',
    nodeEnv:         'test',
    databaseUrl:     connectionString,
    srsApiUrl:       'http://localhost:3000',
    natsUrl:         'nats://localhost:4222', // NATS not running in tests
    jwtSecret:       JWT_SECRET,
    keycloakJwksUrl: undefined,
    corsOrigins:     ['http://localhost:5173'],
  };

  const app = await buildApp(config, appOpts);
  await app.ready();

  const makeJwt = (opts: { sub?: string; roles?: string[]; tenantId?: string } = {}): string => {
    const header  = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({
      sub:                opts.sub ?? 'test-engagement-officer-001',
      tenant_id:          opts.tenantId ?? tenantId,
      realm_roles:        opts.roles ?? ['engagement-officer'],
      name:               'Test Engagement Officer',
      email:              'officer@test.university.ac.uk',
      preferred_username: 'test.officer',
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
