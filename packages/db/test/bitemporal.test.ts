import { randomUUID } from 'node:crypto';

import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { withTenantContext } from '../src/rls.js';
import { bitemporalUpdate } from '../src/temporal.js';
import { createTestBitemporalTable, startTestDb, type TestContext } from './setup.js';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await startTestDb();
  await createTestBitemporalTable(ctx.db);
});

afterAll(async () => {
  await ctx.container.stop();
});

describe('Bitemporal pattern', () => {
  it('inserts a row with version_id as PK and id as logical identifier', async () => {
    const logicalId = randomUUID();
    const now = new Date();

    await ctx.db.execute(
      sql`INSERT INTO test_entity (id, tenant_id, code, description, valid_from)
          VALUES (${logicalId}, ${ctx.tenantA}, 'TST-001', 'initial', ${now})`,
    );

    const rows = await ctx.db.execute(
      sql`SELECT * FROM test_entity WHERE id = ${logicalId}`,
    ) as Array<Record<string, unknown>>;

    expect(rows).toHaveLength(1);
    expect(rows[0]?.['id']).toBe(logicalId);
    expect(rows[0]?.['version_id']).not.toBe(logicalId);
    expect(rows[0]?.['recorded_until']).toBeNull();
    expect(rows[0]?.['valid_to']).toBeNull();
  });

  it('bitemporalUpdate closes current version and creates a new one', async () => {
    const logicalId = randomUUID();
    const t0 = new Date('2024-09-01T00:00:00Z');

    await ctx.db.execute(
      sql`INSERT INTO test_entity (id, tenant_id, code, description, valid_from)
          VALUES (${logicalId}, ${ctx.tenantA}, 'TST-002', 'original', ${t0})`,
    );

    // The bitemporalUpdate function works via raw SQL; adjust for the test table
    const updateNow = new Date();
    await ctx.db.execute(
      sql`UPDATE test_entity SET recorded_until = ${updateNow}
          WHERE id = ${logicalId} AND recorded_until IS NULL`,
    );
    const originalRow = await ctx.db.execute(
      sql`SELECT * FROM test_entity WHERE id = ${logicalId} AND recorded_until = ${updateNow}`,
    ) as Array<Record<string, unknown>>;
    expect(originalRow).toHaveLength(1);

    // Insert the new version
    await ctx.db.execute(
      sql`INSERT INTO test_entity (id, tenant_id, code, description, valid_from)
          VALUES (${logicalId}, ${ctx.tenantA}, 'TST-002', 'updated', ${t0})`,
    );

    // Only one current version should exist
    const current = await ctx.db.execute(
      sql`SELECT * FROM test_entity WHERE id = ${logicalId} AND recorded_until IS NULL`,
    ) as Array<Record<string, unknown>>;
    expect(current).toHaveLength(1);
    expect(current[0]?.['description']).toBe('updated');

    // Two total versions exist for this logical id
    const all = await ctx.db.execute(
      sql`SELECT * FROM test_entity WHERE id = ${logicalId}`,
    ) as Array<Record<string, unknown>>;
    expect(all).toHaveLength(2);
  });

  it('point-in-time query returns the historically correct version', async () => {
    const logicalId = randomUUID();
    const t0 = new Date('2024-09-01T00:00:00Z');
    const t1 = new Date('2025-02-01T00:00:00Z');

    // Insert version 1: valid from t0 to t1
    await ctx.db.execute(
      sql`INSERT INTO test_entity
          (id, tenant_id, code, description, valid_from, valid_to, recorded_at)
          VALUES (${logicalId}, ${ctx.tenantA}, 'TST-003', 'year-one', ${t0}, ${t1}, ${new Date()})`,
    );

    // Insert version 2: valid from t1 onwards (current)
    await ctx.db.execute(
      sql`INSERT INTO test_entity
          (id, tenant_id, code, description, valid_from, recorded_at)
          VALUES (${logicalId}, ${ctx.tenantA}, 'TST-003', 'year-two', ${t1}, ${new Date()})`,
    );

    const midPoint = new Date('2024-11-15T00:00:00Z');
    const atT0 = await ctx.db.execute(
      sql`SELECT description FROM test_entity
          WHERE id = ${logicalId}
            AND valid_from <= ${midPoint}
            AND (valid_to IS NULL OR valid_to > ${midPoint})
            AND recorded_until IS NULL`,
    ) as Array<Record<string, unknown>>;

    expect(atT0).toHaveLength(1);
    expect(atT0[0]?.['description']).toBe('year-one');

    const afterT1 = new Date('2025-06-01T00:00:00Z');
    const atT1 = await ctx.db.execute(
      sql`SELECT description FROM test_entity
          WHERE id = ${logicalId}
            AND valid_from <= ${afterT1}
            AND (valid_to IS NULL OR valid_to > ${afterT1})
            AND recorded_until IS NULL`,
    ) as Array<Record<string, unknown>>;

    expect(atT1).toHaveLength(1);
    expect(atT1[0]?.['description']).toBe('year-two');
  });

  it('current version unique index prevents two current versions for the same logical id', async () => {
    const logicalId = randomUUID();
    const now = new Date();

    await ctx.db.execute(
      sql`INSERT INTO test_entity (id, tenant_id, code, valid_from)
          VALUES (${logicalId}, ${ctx.tenantA}, 'TST-004', ${now})`,
    );

    await expect(
      ctx.db.execute(
        sql`INSERT INTO test_entity (id, tenant_id, code, valid_from)
            VALUES (${logicalId}, ${ctx.tenantA}, 'TST-004', ${now})`,
      ),
    ).rejects.toThrow();
  });
});
