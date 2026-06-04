import { randomUUID } from 'node:crypto';

import { sql } from 'drizzle-orm';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';

import { createDb, type Db } from '../src/pool.js';
import { rlsPolicySql, type TenantScopedDb } from '../src/rls.js';
import { bitemporalConstraintsSql } from '../src/temporal.js';

export interface TestContext {
  container: StartedPostgreSqlContainer;
  db:        Db;
  tenantA:   string;
  tenantB:   string;
}

export async function startTestDb(): Promise<TestContext> {
  const container = await new PostgreSqlContainer('postgres:16-alpine')
    .withEnvironment({ POSTGRES_DB: 'srs_test' })
    .start();

  const db = createDb(container.getConnectionUri());

  // Bootstrap schema
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS tenant (
      id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      code      TEXT NOT NULL UNIQUE,
      name      TEXT NOT NULL,
      configuration JSONB NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      active    BOOLEAN NOT NULL DEFAULT true
    );

    CREATE TABLE IF NOT EXISTS audit_record (
      id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id           UUID,
      entity_type         TEXT NOT NULL,
      entity_id           UUID NOT NULL,
      field_name          TEXT,
      before_value        JSONB,
      after_value         JSONB,
      action_type         TEXT NOT NULL,
      actor_type          TEXT NOT NULL,
      actor_id            TEXT NOT NULL,
      actor_display_name  TEXT,
      occurred_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
      correlation_id      UUID,
      workflow_instance_id TEXT,
      reason_code         TEXT,
      reason_text         TEXT
    );
  `);

  const tenantA = randomUUID();
  const tenantB = randomUUID();

  await db.execute(
    sql`INSERT INTO tenant (id, code, name) VALUES
          (${tenantA}, 'UNIVA', 'University A'),
          (${tenantB}, 'UNIVB', 'University B')`,
  );

  return { container, db, tenantA, tenantB };
}

/**
 * Create a minimal bitemporal test table and enable RLS.
 * Used by bitemporal.test.ts and rls.test.ts.
 *
 * Also creates a non-privileged srs_app role (no BYPASSRLS) so that
 * withAppContext() can test true RLS filtering within the same connection.
 */
export async function createTestBitemporalTable(db: Db): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS test_entity (
      version_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      id            UUID NOT NULL,
      tenant_id     UUID NOT NULL REFERENCES tenant(id),
      code          TEXT NOT NULL,
      description   TEXT,
      valid_from    TIMESTAMPTZ NOT NULL,
      valid_to      TIMESTAMPTZ,
      recorded_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      recorded_until TIMESTAMPTZ
    );
  `);

  await db.execute(sql.raw(bitemporalConstraintsSql('test_entity')));
  await db.execute(sql.raw(rlsPolicySql('test_entity')));

  // Create a non-superuser application role so RLS tests can drop privileges.
  await db.execute(sql.raw(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'srs_app') THEN
        CREATE ROLE srs_app NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
      END IF;
    END $$;
    GRANT srs_app TO CURRENT_USER;
    GRANT SELECT, INSERT, UPDATE, DELETE ON test_entity TO srs_app;
    GRANT SELECT ON tenant TO srs_app;
  `));
}

/**
 * Execute fn inside a transaction that (a) drops to the srs_app role so RLS
 * is enforced and (b) sets the tenant context for the RLS policy.
 *
 * The superuser connection is required to SET ROLE; srs_app itself cannot
 * escalate privileges back.
 */
export async function withAppContext<T>(
  db: Db,
  tenantId: string,
  fn: (tx: TenantScopedDb) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql.raw("SET LOCAL ROLE srs_app"));
    await tx.execute(sql`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`);
    return fn(tx);
  });
}
