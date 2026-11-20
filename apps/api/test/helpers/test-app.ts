import { createHmac } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { sql } from 'drizzle-orm';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { createDb, type Db } from '@revelation-srs/db';

import { buildApp } from '../../src/app.js';
import type { Config } from '../../src/config.js';
import type { IntegrationBusPublisher } from '../../src/platform/integration-bus/publisher.js';

const JWT_SECRET = 'test-secret-for-phase4-int-tests';

export interface TestApp {
  app:         Awaited<ReturnType<typeof buildApp>>;
  container:   StartedPostgreSqlContainer;
  /** Superuser connection for seeding and assertions; the app itself runs as srs_app. */
  db:          Db;
  tenantId:    string;
  secondTenantId: string;
  teardown:    () => Promise<void>;
  makeJwt:     (opts?: { sub?: string; roles?: string[]; tenantId?: string; srsPersonId?: string }) => Promise<string>;
}

const MIGRATIONS_DIR = new URL('../../../../packages/db/migrations/', import.meta.url);

/** Apply every core migration in journal order, as `npm run migrate` does. */
async function applyCoreMigrations(db: Db): Promise<void> {
  const journal = JSON.parse(await readFile(fileURLToPath(new URL('meta/_journal.json', MIGRATIONS_DIR)), 'utf8')) as { entries: Array<{ tag: string }> };
  for (const { tag } of journal.entries) {
    await db.execute(sql.raw(await readFile(fileURLToPath(new URL(`${tag}.sql`, MIGRATIONS_DIR)), 'utf8')));
  }
}

export interface StartTestAppOptions {
  /** Where the engagement proxy forwards to, and how long it waits. */
  attendance?: { url: string; timeoutMs?: number };
  /** Fastify trustProxy (TRUST_PROXY); off unless given. */
  trustProxy?: Config['trustProxy'];
  /** Validate RS256 tokens against this JWKS, issuer and audience instead of the HS256 test secret. */
  auth?: Pick<Config, 'keycloakJwksUrl' | 'keycloakIssuer' | 'keycloakAudience' | 'jwtClockToleranceSeconds'>;
  /** Inject a spy or stub event bus instead of the default disconnected NATS publisher. */
  eventBus?: IntegrationBusPublisher;
  /** Enable live Temporal execution against this server (the rollout flag still applies). */
  temporal?: {
    address: string;
    namespace: string;
    taskQueue: string;
    decisionWaitMs?: number;
  };
}

/** Start a throw-away API instance backed by a fresh Testcontainers PostgreSQL. */
export async function startTestApp(opts: StartTestAppOptions = {}): Promise<TestApp> {
  const container = await new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase('srs_test')
    .start();
  const connectionString = container.getConnectionUri();
  const db = createDb(connectionString);

  await applyCoreMigrations(db);

  // Seed a tenant for tests
  const tenantId = '00000000-0000-0000-0000-000000000001';
  await db.execute(sql`
    INSERT INTO tenant (id, code, name, active)
    VALUES (${tenantId}, 'TEST', 'Test University', true)
  `);
  const secondTenantId = '00000000-0000-0000-0000-000000000002';
  await db.execute(sql`
    INSERT INTO tenant (id, code, name, active)
    VALUES (${secondTenantId}, 'TEST2', 'Second Test University', true)
  `);

  // The app connects as a login role that inherits srs_app, as it does in
  // every deployment: not the owner, not a superuser, no BYPASSRLS, so
  // row-level security applies to every query it makes. The test's own `db`
  // stays the superuser connection, for seeding and for asserting on rows.
  await db.execute(sql.raw(`
    CREATE ROLE srs_api_test LOGIN PASSWORD 'srs_api_test' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS INHERIT;
    GRANT srs_app TO srs_api_test;
  `));
  const appUrl = new URL(connectionString);
  appUrl.username = 'srs_api_test';
  appUrl.password = 'srs_api_test';

  const config: Config = {
    port:             3001,
    logLevel:         process.env['TEST_LOG_LEVEL'] ?? 'silent',  // TEST_LOG_LEVEL=error shows server errors
    nodeEnv:          'test',
    databaseUrl:      appUrl.toString(),
    natsUrl:          'nats://localhost:4222',  // NATS not needed for these tests
    temporalAddress:  opts.temporal?.address ?? 'localhost:7233',
    ...(opts.temporal ? {
      temporalExecutionEnabled: true,
      temporalNamespace: opts.temporal.namespace,
      temporalTaskQueue: opts.temporal.taskQueue,
      temporalDecisionWaitMs: opts.temporal.decisionWaitMs ?? 10_000,
      temporalReconcileGraceSeconds: 0,
    } : {}),
    deploymentEnvironmentCode: 'test',
    releaseVersion:   '0.0.0-test',
    imageDigest:      undefined,
    migrationVersion: '0001_security_and_tenant_isolation',
    jwtSecret:        JWT_SECRET,
    keycloakJwksUrl:  undefined,
    ...opts.auth,
    attendanceApiUrl: opts.attendance?.url ?? 'http://127.0.0.1:9',
    ...(opts.attendance?.timeoutMs !== undefined ? { engagementProxyTimeoutMs: opts.attendance.timeoutMs } : {}),
    ...(opts.trustProxy !== undefined ? { trustProxy: opts.trustProxy } : {}),
    corsOrigins:      ['http://localhost:5173'],
    otelEndpoint:     undefined,
    otelServiceName:  'srs-api-test',
  };

  const app = await buildApp(config, { eventBus: opts.eventBus });
  await app.ready();

  // Build HS256 JWTs using Node.js built-in crypto — matches the jwtPlugin's
  // HS256 development path (no external jose / jsonwebtoken dependency needed).
  const makeJwt = (opts: { sub?: string; roles?: string[]; tenantId?: string; srsPersonId?: string } = {}): Promise<string> => {
    const header  = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({
      sub:                opts.sub ?? 'test-user-001',
      tenant_id:          opts.tenantId ?? tenantId,
      realm_roles:        opts.roles ?? ['registry-administrator'],
      name:               'Test User',
      email:              'test@test.university.ac.uk',
      preferred_username: 'test.user',
      ...(opts.srsPersonId ? { srs_person_id: opts.srsPersonId } : {}),
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
    })).toString('base64url');
    const signingInput = `${header}.${payload}`;
    const sig = createHmac('sha256', JWT_SECRET).update(signingInput).digest('base64url');
    return Promise.resolve(`${signingInput}.${sig}`);
  };

  const teardown = async () => {
    await app.close();
    await container.stop();
  };

  return { app, container, db, tenantId, secondTenantId, teardown, makeJwt };
}
