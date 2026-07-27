import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { sql } from 'drizzle-orm';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDb, type Db } from '../src/pool.js';

import { withAppContext } from './setup.js';

let container: StartedPostgreSqlContainer;
let db: Db;
let tenantA: string;
let tenantB: string;

async function applyMigration(fileName: string): Promise<void> {
  const migration = await readFile(new URL(`../migrations/${fileName}`, import.meta.url), 'utf8');
  await db.execute(sql.raw(migration));
}

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine')
    .withEnvironment({ POSTGRES_DB: 'srs_engagement_test' })
    .start();
  db = createDb(container.getConnectionUri());

  await applyMigration('0000_initial_platform_schema.sql');
  await applyMigration('0001_seed_value_sets.sql');
  await applyMigration('0037_engagement_intervention.sql');

  tenantA = randomUUID();
  tenantB = randomUUID();
  await db.execute(sql`
    INSERT INTO tenant (id, code, name)
    VALUES (${tenantA}, 'ENG-A', 'Engagement A'), (${tenantB}, 'ENG-B', 'Engagement B')
  `);

  await db.execute(sql.raw(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'srs_app') THEN
        CREATE ROLE srs_app NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
      END IF;
    END $$;
    GRANT srs_app TO CURRENT_USER;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO srs_app;
  `));
});

afterAll(async () => {
  await container?.stop();
});

describe('engagement migration 0037', () => {
  it('creates all nine tenant-isolated aggregate tables', async () => {
    const rows = await db.execute(sql`
      SELECT relname, relrowsecurity, relforcerowsecurity
      FROM pg_class
      WHERE relname IN (
        'engagement_policy_version',
        'expected_engagement_event',
        'engagement_observation',
        'engagement_observation_revision',
        'engagement_alert',
        'engagement_intervention_case',
        'engagement_contact_attempt',
        'engagement_action',
        'engagement_referral'
      )
    `) as Array<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>;

    expect(rows).toHaveLength(9);
    expect(rows.every((row) => row.relrowsecurity && row.relforcerowsecurity)).toBe(true);
  });

  it('prevents tenant B from seeing tenant A expected events', async () => {
    const eventId = randomUUID();
    await db.execute(sql`
      INSERT INTO expected_engagement_event (
        id, tenant_id, person_id, enrolment_id, activity_type_code,
        event_mode_code, scheduled_from, source_system_code, source_event_id,
        source_version, actor_id, valid_from
      ) VALUES (
        ${eventId}, ${tenantA}, ${randomUUID()}, ${randomUUID()}, 'lecture',
        'in-person', now(), 'timetable', 'TT-001', '1', 'system', now()
      )
    `);

    const rows = await withAppContext(db, tenantB, async (tx) =>
      tx.execute(sql`SELECT id FROM expected_engagement_event WHERE id = ${eventId}`),
    );
    expect(rows).toHaveLength(0);
  });

  it('enforces source idempotency for observations', async () => {
    const values = {
      id: randomUUID(),
      personId: randomUUID(),
      enrolmentId: randomUUID(),
    };
    await db.execute(sql`
      INSERT INTO engagement_observation (
        id, tenant_id, person_id, enrolment_id, source_system_code,
        source_event_id, source_version, idempotency_key, capture_method_code,
        outcome_code, event_time, actor_id, valid_from
      ) VALUES (
        ${values.id}, ${tenantA}, ${values.personId}, ${values.enrolmentId}, 'vle',
        'VLE-001', '1', 'IDEMP-001', 'vle-activity',
        'attended', now(), 'integration-service', now()
      )
    `);

    await expect(db.execute(sql`
      INSERT INTO engagement_observation (
        id, tenant_id, person_id, enrolment_id, source_system_code,
        source_event_id, source_version, idempotency_key, capture_method_code,
        outcome_code, event_time, actor_id, valid_from
      ) VALUES (
        ${randomUUID()}, ${tenantA}, ${values.personId}, ${values.enrolmentId}, 'vle',
        'VLE-002', '1', 'IDEMP-001', 'vle-activity',
        'attended', now(), 'integration-service', now()
      )
    `)).rejects.toThrow();
  });

  it('allows closing a current observation but rejects mutation of closed history', async () => {
    const observationId = randomUUID();
    await db.execute(sql`
      INSERT INTO engagement_observation (
        id, tenant_id, person_id, enrolment_id, source_system_code,
        source_event_id, source_version, idempotency_key, capture_method_code,
        outcome_code, event_time, actor_id, valid_from
      ) VALUES (
        ${observationId}, ${tenantA}, ${randomUUID()}, ${randomUUID()}, 'manual',
        'MAN-001', '1', 'IDEMP-002', 'staff-entry',
        'absent', now(), 'tutor-1', now()
      )
    `);
    await db.execute(sql`
      UPDATE engagement_observation
      SET recorded_until = now()
      WHERE tenant_id = ${tenantA} AND id = ${observationId} AND recorded_until IS NULL
    `);

    await expect(db.execute(sql`
      UPDATE engagement_observation
      SET outcome_code = 'attended'
      WHERE tenant_id = ${tenantA} AND id = ${observationId}
    `)).rejects.toThrow('closed engagement observation versions are immutable');

    await expect(db.execute(sql`
      DELETE FROM engagement_observation
      WHERE tenant_id = ${tenantA} AND id = ${observationId}
    `)).rejects.toThrow('engagement observation history is append-only');
  });

  it('seeds the nine approved generic value-set definitions and field mappings', async () => {
    const sets = await db.execute(sql`
      SELECT set_code FROM value_set WHERE set_code LIKE 'engagement-%-code'
    `) as Array<{ set_code: string }>;
    const mappings = await db.execute(sql`
      SELECT entity_name, field_name FROM field_value_set
      WHERE entity_name LIKE '%engagement%' OR entity_name = 'expected_engagement_event'
    `) as Array<{ entity_name: string; field_name: string }>;

    expect(sets).toHaveLength(9);
    expect(mappings).toHaveLength(9);
  });
});
