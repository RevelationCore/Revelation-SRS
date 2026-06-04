import { readFile } from 'node:fs/promises';

import { sql } from 'drizzle-orm';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDb, type Db } from '../src/pool.js';

let container: StartedPostgreSqlContainer;
let db: Db;

async function applyMigration(fileName: string): Promise<void> {
  const migration = await readFile(new URL(`../migrations/${fileName}`, import.meta.url), 'utf8');
  await db.execute(sql.raw(migration));
}

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine')
    .withEnvironment({ POSTGRES_DB: 'srs_migration_test' })
    .start();

  db = createDb(container.getConnectionUri());

  await applyMigration('0000_initial_platform_schema.sql');
  await applyMigration('0001_seed_value_sets.sql');
});

afterAll(async () => {
  await container?.stop();
});

describe('Phase 3 migrations', () => {
  it('creates the platform foundation tables', async () => {
    const rows = await db.execute(sql`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN (
          'tenant',
          'audit_record',
          'integration_contract',
          'integration_registration',
          'integration_exchange',
          'academic_rule',
          'value_set',
          'value_set_member',
          'field_value_set'
        )
    `) as Array<{ table_name: string }>;

    expect(rows.map((r) => r.table_name).sort()).toEqual([
      'academic_rule',
      'audit_record',
      'field_value_set',
      'integration_contract',
      'integration_exchange',
      'integration_registration',
      'tenant',
      'value_set',
      'value_set_member',
    ]);
  });

  it('enables and forces RLS on tenant-scoped tables', async () => {
    const rows = await db.execute(sql`
      SELECT relname, relrowsecurity, relforcerowsecurity
      FROM pg_class
      WHERE relname IN (
        'integration_registration',
        'integration_exchange',
        'academic_rule',
        'value_set_member'
      )
    `) as Array<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>;

    expect(rows).toHaveLength(4);
    for (const row of rows) {
      expect(row.relrowsecurity).toBe(true);
      expect(row.relforcerowsecurity).toBe(true);
    }
  });

  it('creates bitemporal and integration uniqueness constraints', async () => {
    const rows = await db.execute(sql`
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname IN (
          'academic_rule_unique_logical_transaction',
          'academic_rule_current_version_unique',
          'integration_registration_tenant_code_unique',
          'integration_exchange_idempotency_unique'
        )
    `) as Array<{ indexname: string }>;

    expect(rows.map((r) => r.indexname).sort()).toEqual([
      'academic_rule_current_version_unique',
      'academic_rule_unique_logical_transaction',
      'integration_exchange_idempotency_unique',
      'integration_registration_tenant_code_unique',
    ]);
  });

  it('seeds platform value sets and field mappings', async () => {
    const sets = await db.execute(sql`
      SELECT set_code
      FROM value_set
      WHERE set_code IN (
        'hesa-disability-code',
        'enrolment-status-code',
        'integration-exchange-status'
      )
    `) as Array<{ set_code: string }>;

    const mappings = await db.execute(sql`
      SELECT entity_name, field_name, value_set_code
      FROM field_value_set
      WHERE entity_name = 'integration_exchange'
        AND field_name = 'status_code'
    `) as Array<{ entity_name: string; field_name: string; value_set_code: string }>;

    expect(sets).toHaveLength(3);
    expect(mappings).toEqual([
      {
        entity_name: 'integration_exchange',
        field_name: 'status_code',
        value_set_code: 'integration-exchange-status',
      },
    ]);
  });
});
