import { randomUUID } from 'node:crypto';

import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { TenantScopedDb } from '../src/rls.js';

import { createTestBitemporalTable, startTestDb, withAppContext, type TestContext } from './setup.js';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await startTestDb();
  await createTestBitemporalTable(ctx.db);
});

afterAll(async () => {
  await ctx?.container.stop();
});

describe('Row-Level Security', () => {
  it('a query scoped to tenant A cannot see tenant B records', async () => {
    const idA = randomUUID();
    const idB = randomUUID();
    const now  = new Date();

    // Insert records for both tenants without RLS (superuser direct write)
    await ctx.db.execute(
      sql`INSERT INTO test_entity (id, tenant_id, code, valid_from)
          VALUES (${idA}, ${ctx.tenantA}, 'RLS-A', ${now}),
                 (${idB}, ${ctx.tenantB}, 'RLS-B', ${now})`,
    );

    // Querying as tenant A through the non-privileged app role must only return tenant A's row
    const rowsAsA = await withAppContext(ctx.db, ctx.tenantA, async (tx: TenantScopedDb) =>
      tx.execute(
        sql`SELECT code FROM test_entity WHERE code IN ('RLS-A', 'RLS-B')`,
      ) as Promise<Array<Record<string, unknown>>>,
    );

    expect(rowsAsA.map((r: Record<string, unknown>) => r['code'])).toEqual(['RLS-A']);
  });

  it('a query scoped to tenant B cannot see tenant A records', async () => {
    const idA = randomUUID();
    const idB = randomUUID();
    const now  = new Date();

    await ctx.db.execute(
      sql`INSERT INTO test_entity (id, tenant_id, code, valid_from)
          VALUES (${idA}, ${ctx.tenantA}, 'RLS-C', ${now}),
                 (${idB}, ${ctx.tenantB}, 'RLS-D', ${now})`,
    );

    const rowsAsB = await withAppContext(ctx.db, ctx.tenantB, async (tx: TenantScopedDb) =>
      tx.execute(
        sql`SELECT code FROM test_entity WHERE code IN ('RLS-C', 'RLS-D')`,
      ) as Promise<Array<Record<string, unknown>>>,
    );

    expect(rowsAsB.map((r: Record<string, unknown>) => r['code'])).toEqual(['RLS-D']);
  });

  it('a write to a tenant A row is not visible when querying as tenant B', async () => {
    const idA = randomUUID();
    const now  = new Date();

    await ctx.db.execute(
      sql`INSERT INTO test_entity (id, tenant_id, code, valid_from)
          VALUES (${idA}, ${ctx.tenantA}, 'RLS-E', ${now})`,
    );

    const rowsAsB = await withAppContext(ctx.db, ctx.tenantB, async (tx: TenantScopedDb) =>
      tx.execute(
        sql`SELECT code FROM test_entity WHERE id = ${idA}`,
      ) as Promise<Array<Record<string, unknown>>>,
    );

    expect(rowsAsB).toHaveLength(0);
  });

  it('rejects writes where the row tenant does not match the active tenant context', async () => {
    const id = randomUUID();
    const now = new Date();

    await expect(
      withAppContext(ctx.db, ctx.tenantA, async (tx: TenantScopedDb) =>
        tx.execute(
          sql`INSERT INTO test_entity (id, tenant_id, code, valid_from)
              VALUES (${id}, ${ctx.tenantB}, 'RLS-WRITE-BLOCKED', ${now})`,
        ) as Promise<Array<Record<string, unknown>>>,
      ),
    ).rejects.toThrow();
  });
});
