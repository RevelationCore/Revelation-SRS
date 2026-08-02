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
    .withEnvironment({ POSTGRES_DB: 'srs_business_case_test' })
    .start();
  db = createDb(container.getConnectionUri());

  // Apply the full clean-build sequence: 0004's post-ratification value-set
  // repoint (originally migration 0049) depends on a value set seeded in
  // 0002 (originally migration 0027), so a minimal 0000+0004 subset is no
  // longer sufficient once those were squashed into separate files.
  await applyMigration('0000_platform_foundations.sql');
  await applyMigration('0001_platform_hardening_and_refinements.sql');
  await applyMigration('0002_demo_performance_and_seed_data.sql');
  await applyMigration('0003_engagement_and_attendance.sql');
  await applyMigration('0004_business_process_foundations.sql');

  tenantA = randomUUID();
  tenantB = randomUUID();
  await db.execute(sql`
    INSERT INTO tenant (id, code, name)
    VALUES (${tenantA}, 'CASE-A', 'Case A'), (${tenantB}, 'CASE-B', 'Case B')
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

describe('business-case foundations migration 0044', () => {
  it('creates all seven tenant-isolated primitive tables', async () => {
    const rows = await db.execute(sql`
      SELECT relname, relrowsecurity, relforcerowsecurity
      FROM pg_class
      WHERE relname IN (
        'business_case',
        'case_evidence_reference',
        'case_decision',
        'source_version_reference',
        'distribution_item',
        'distribution_attempt',
        'distribution_acknowledgement'
      )
    `) as Array<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>;

    expect(rows).toHaveLength(7);
    expect(rows.every((row) => row.relrowsecurity && row.relforcerowsecurity)).toBe(true);
  });

  it('prevents tenant B from seeing tenant A business cases', async () => {
    const caseId = randomUUID();
    await db.execute(sql`
      INSERT INTO business_case (
        id, tenant_id, subject_type, subject_id, process_id, status_code,
        owner_id, actor_id, valid_from
      ) VALUES (
        ${caseId}, ${tenantA}, 'person', ${randomUUID()}, 'BP-08-003', 'open',
        'registry', 'system', now()
      )
    `);

    const rowsAsB = await withAppContext(db, tenantB, async (tx) =>
      tx.execute(sql`SELECT id FROM business_case WHERE id = ${caseId}`),
    );
    expect(rowsAsB).toHaveLength(0);

    const rowsAsA = await withAppContext(db, tenantA, async (tx) =>
      tx.execute(sql`SELECT id FROM business_case WHERE id = ${caseId}`),
    );
    expect(rowsAsA).toHaveLength(1);
  });

  it('enforces one current version per logical business case', async () => {
    const caseId = randomUUID();
    await db.execute(sql`
      INSERT INTO business_case (
        id, tenant_id, subject_type, subject_id, process_id, status_code,
        owner_id, actor_id, valid_from
      ) VALUES (
        ${caseId}, ${tenantA}, 'person', ${randomUUID()}, 'BP-08-003', 'open',
        'registry', 'system', now()
      )
    `);

    await expect(db.execute(sql`
      INSERT INTO business_case (
        id, tenant_id, subject_type, subject_id, process_id, status_code,
        owner_id, actor_id, valid_from
      ) VALUES (
        ${caseId}, ${tenantA}, 'person', ${randomUUID()}, 'BP-08-003', 'under-review',
        'registry', 'system', now()
      )
    `)).rejects.toThrow();
  });

  it('links a distribution item to attempt and acknowledgement rows', async () => {
    const itemId = randomUUID();
    await db.execute(sql`
      INSERT INTO distribution_item (id, tenant_id, target_system_code, content_ref)
      VALUES (${itemId}, ${tenantA}, 'vle', 'ref-001')
    `);
    await db.execute(sql`
      INSERT INTO distribution_attempt (id, tenant_id, distribution_item_id, transport_code)
      VALUES (${randomUUID()}, ${tenantA}, ${itemId}, 'https')
    `);
    await db.execute(sql`
      INSERT INTO distribution_acknowledgement (id, tenant_id, distribution_item_id, result_code)
      VALUES (${randomUUID()}, ${tenantA}, ${itemId}, 'applied')
    `);

    const rowsAsB = await withAppContext(db, tenantB, async (tx) =>
      tx.execute(sql`SELECT id FROM distribution_attempt WHERE distribution_item_id = ${itemId}`),
    );
    expect(rowsAsB).toHaveLength(0);
  });
});
