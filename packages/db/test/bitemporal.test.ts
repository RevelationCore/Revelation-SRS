import { randomUUID } from 'node:crypto';

import { sql } from 'drizzle-orm';
import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { bitemporalUpdate, currentVersionWhere } from '../src/temporal.js';

import { createTestBitemporalTable, startTestDb, type TestContext } from './setup.js';

let ctx: TestContext;

const testEntity = pgTable('test_entity', {
  versionId:     uuid('version_id').primaryKey().defaultRandom(),
  id:            uuid('id').notNull(),
  tenantId:      uuid('tenant_id').notNull(),
  code:          text('code').notNull(),
  description:   text('description'),
  validFrom:     timestamp('valid_from', { withTimezone: true }).notNull(),
  validTo:       timestamp('valid_to', { withTimezone: true }),
  recordedAt:    timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
  recordedUntil: timestamp('recorded_until', { withTimezone: true }),
});

beforeAll(async () => {
  ctx = await startTestDb();
  await createTestBitemporalTable(ctx.db);
});

afterAll(async () => {
  await ctx?.container.stop();
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

    await bitemporalUpdate(
      ctx.db,
      testEntity,
      logicalId,
      ctx.tenantA,
      { description: 'updated' },
    );

    const closed = await ctx.db.execute(
      sql`SELECT * FROM test_entity WHERE id = ${logicalId} AND recorded_until IS NOT NULL`,
    ) as Array<Record<string, unknown>>;
    expect(closed).toHaveLength(1);
    expect(closed[0]?.['description']).toBe('original');

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

  it('currentVersionWhere excludes future-dated and expired-valid rows', async () => {
    const futureId = randomUUID();
    const expiredId = randomUUID();

    await ctx.db.execute(
      sql`INSERT INTO test_entity (id, tenant_id, code, description, valid_from)
          VALUES (${futureId}, ${ctx.tenantA}, 'TST-FUTURE', 'future', ${new Date('2999-01-01T00:00:00Z')})`,
    );

    await ctx.db.execute(
      sql`INSERT INTO test_entity (id, tenant_id, code, description, valid_from, valid_to)
          VALUES (${expiredId}, ${ctx.tenantA}, 'TST-EXPIRED', 'expired',
                  ${new Date('2020-01-01T00:00:00Z')}, ${new Date('2020-12-31T00:00:00Z')})`,
    );

    const futureRows = await ctx.db
      .select()
      .from(testEntity)
      .where(currentVersionWhere(testEntity, futureId, ctx.tenantA));

    const expiredRows = await ctx.db
      .select()
      .from(testEntity)
      .where(currentVersionWhere(testEntity, expiredId, ctx.tenantA));

    expect(futureRows).toHaveLength(0);
    expect(expiredRows).toHaveLength(0);
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
