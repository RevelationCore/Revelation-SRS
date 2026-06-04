import { randomUUID } from 'node:crypto';

import { sql } from 'drizzle-orm';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';

import { createDb, type Db } from '../src/pool.js';
import { rlsPolicySql } from '../src/rls.js';
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
      recorded_until TIMESTAMPTZ,
      CONSTRAINT test_entity_temporal_check_valid
        CHECK (valid_to IS NULL OR valid_to > valid_from),
      CONSTRAINT test_entity_temporal_check_recorded
        CHECK (recorded_until IS NULL OR recorded_until > recorded_at)
    );
  `);

  await db.execute(sql.raw(bitemporalConstraintsSql('test_entity')));
  await db.execute(sql.raw(rlsPolicySql('test_entity')));
}
