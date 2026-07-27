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
  db:          Db;
  tenantId:    string;
  secondTenantId: string;
  teardown:    () => Promise<void>;
  makeJwt:     (opts?: { sub?: string; roles?: string[]; tenantId?: string }) => Promise<string>;
}

async function applyMigration(db: Db, fileName: string): Promise<void> {
  const dir = new URL('../../../../packages/db/migrations/', import.meta.url);
  const sql_ = await readFile(fileURLToPath(new URL(fileName, dir)), 'utf8');
  await db.execute(sql.raw(sql_));
}

export interface StartTestAppOptions {
  /** Inject a spy or stub event bus instead of the default disconnected NATS publisher. */
  eventBus?: IntegrationBusPublisher;
}

/** Start a throw-away API instance backed by a fresh Testcontainers PostgreSQL. */
export async function startTestApp(opts: StartTestAppOptions = {}): Promise<TestApp> {
  const container = await new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase('srs_test')
    .start();
  const connectionString = container.getConnectionUri();
  const db = createDb(connectionString);

  // Apply all migrations in order
  await applyMigration(db, '0000_initial_platform_schema.sql');
  await applyMigration(db, '0001_seed_value_sets.sql');
  await applyMigration(db, '0002_phase4_domain_schema.sql');
  await applyMigration(db, '0003_seed_phase4_field_mappings.sql');
  await applyMigration(db, '0004_phase5_assessment_schema.sql');
  await applyMigration(db, '0005_seed_phase5_field_mappings.sql');
  await applyMigration(db, '0006_phase6_regulatory_schema.sql');
  await applyMigration(db, '0007_seed_phase6_field_mappings.sql');
  await applyMigration(db, '0008_phase6_remediation.sql');
  await applyMigration(db, '0009_platform_workflow_feature_flags.sql');
  await applyMigration(db, '0010_relax_extensible_code_checks.sql');
  await applyMigration(db, '0011_environment_promotion_hardening.sql');
  await applyMigration(db, '0012_globalisation_foundation.sql');
  await applyMigration(db, '0013_workflow_coverage_matrix.sql');
  await applyMigration(db, '0014_stage3_assessment_grade_progression.sql');
  await applyMigration(db, '0015_stage4_exam_board_governance.sql');
  await applyMigration(db, '0016_stage5_admissions_communications.sql');
  await applyMigration(db, '0017_stage6_flag_governance.sql');
  await applyMigration(db, '0018_stage7_legacy_removal.sql');
  await applyMigration(db, '0019_phase7_integration_registry.sql');
  await applyMigration(db, '0020_phase7_contract_deprecation.sql');
  await applyMigration(db, '0021_phase9_vle_contracts.sql');
  await applyMigration(db, '0022_demo_tenant_mode.sql');
  await applyMigration(db, '0023_demo_status_checkpoint.sql');
  await applyMigration(db, '0024_phase11_performance_indexes.sql');
  await applyMigration(db, '0025_phase11_retention_anonymisation.sql');
  await applyMigration(db, '0026_phase11_notifications.sql');
  await applyMigration(db, '0027_valueset_picklists.sql');
  await applyMigration(db, '0028_valueset_correction_status.sql');
  await applyMigration(db, '0029_valueset_activefrom_nullable.sql');
  await applyMigration(db, '0030_seed_nationality_domicile.sql');
  await applyMigration(db, '0031_person_identity_pronouns.sql');
  await applyMigration(db, '0032_seed_fee_band_code.sql');
  await applyMigration(db, '0033_disability_declaration_notes.sql');
  await applyMigration(db, '0037_engagement_intervention.sql');
  await applyMigration(db, '0038_engagement_policy_alert_immutability.sql');
  await applyMigration(db, '0039_engagement_intervention_idempotency.sql');

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

  const config: Config = {
    port:             3001,
    logLevel:         'silent',
    nodeEnv:          'test',
    databaseUrl:      connectionString,
    natsUrl:          'nats://localhost:4222',  // NATS not needed for these tests
    temporalAddress:  'localhost:7233',
    deploymentEnvironmentCode: 'test',
    releaseVersion:   '0.0.0-test',
    imageDigest:      undefined,
    migrationVersion: '0039_engagement_intervention_idempotency',
    jwtSecret:        JWT_SECRET,
    keycloakJwksUrl:  undefined,
    corsOrigins:      ['http://localhost:5173'],
    otelEndpoint:     undefined,
    otelServiceName:  'srs-api-test',
  };

  const app = await buildApp(config, { eventBus: opts.eventBus });
  await app.ready();

  // Build HS256 JWTs using Node.js built-in crypto — matches the jwtPlugin's
  // HS256 development path (no external jose / jsonwebtoken dependency needed).
  const makeJwt = (opts: { sub?: string; roles?: string[]; tenantId?: string } = {}): Promise<string> => {
    const header  = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({
      sub:                opts.sub ?? 'test-user-001',
      tenant_id:          opts.tenantId ?? tenantId,
      realm_roles:        opts.roles ?? ['registry-administrator'],
      name:               'Test User',
      email:              'test@test.university.ac.uk',
      preferred_username: 'test.user',
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
