import { randomUUID } from 'node:crypto';

import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { withTenantContext } from '../src/rls.js';
import { createTestBitemporalTable, startTestDb, type TestContext } from './setup.js';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await startTestDb();
  await createTestBitemporalTable(ctx.db);
});

afterAll(async () => {
  await ctx.container.stop();
});

describe('Row-Level Security', () => {
  it('a query scoped to tenant A cannot see tenant B records', async () => {
    const idA = randomUUID();
    const idB = randomUUID();
    const now  = new Date();

    // Insert a record for each tenant without RLS (direct write)
    await ctx.db.execute(
      sql`INSERT INTO test_entity (id, tenant_id, code, valid_from)
          VALUES (${idA}, ${ctx.tenantA}, 'RLS-A', ${now}),
                 (${idB}, ${ctx.tenantB}, 'RLS-B', ${now})`,
    );

    // Querying as tenant A should only return tenant A's row
    const rowsAsA = await withTenantContext(ctx.db, ctx.tenantA, async (tx) => {
      return tx.execute(
        sql`SELECT code FROM test_entity WHERE code IN ('RLS-A', 'RLS-B')`,
      ) as Promise<Array<Record<string, unknown>>>;
    });

    expect(rowsAsA.map((r) => r['code'])).toEqual(['RLS-A']);
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

    const rowsAsB = await withTenantContext(ctx.db, ctx.tenantB, async (tx) => {
      return tx.execute(
        sql`SELECT code FROM test_entity WHERE code IN ('RLS-C', 'RLS-D')`,
      ) as Promise<Array<Record<string, unknown>>>;
    });

    expect(rowsAsB.map((r) => r['code'])).toEqual(['RLS-D']);
  });

  it('a write to a tenant A row is not visible when querying as tenant B', async () => {
    const idA = randomUUID();
    const now  = new Date();

    await ctx.db.execute(
      sql`INSERT INTO test_entity (id, tenant_id, code, valid_from)
          VALUES (${idA}, ${ctx.tenantA}, 'RLS-E', ${now})`,
    );

    const rowsAsB = await withTenantContext(ctx.db, ctx.tenantB, async (tx) => {
      return tx.execute(
        sql`SELECT code FROM test_entity WHERE id = ${idA}`,
      ) as Promise<Array<Record<string, unknown>>>;
    });

    expect(rowsAsB).toHaveLength(0);
  });
});
