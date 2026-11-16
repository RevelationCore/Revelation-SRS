/**
 * A demo reset wipes every tenant table except the preserved reference,
 * configuration and audit tables — including append-only tables — and
 * touches no other tenant.
 */
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, type Db } from '@revelation-srs/db';

import { GOLDEN_IDS } from '../src/golden-ids.js';
import { PRESERVED_TENANT_TABLES, resetScenario, tenantTablesToWipe } from '../src/reset.js';

import { applyAllMigrations } from './helpers/migrations.js';

const DEMO = 'dd000000-0000-4000-8000-0000000000a1';
const OTHER = 'dd000000-0000-4000-8000-0000000000b2';

let container: StartedPostgreSqlContainer;
let db: Db;

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').withDatabase('srs_reset_test').start();
  db = createDb(container.getConnectionUri());
  await applyAllMigrations(db);
  await db.execute(sql`UPDATE deployment_environment SET active = false WHERE production_like = true`);
  await db.execute(sql`
    INSERT INTO tenant (id, code, name, active, demo_mode) VALUES
      (${DEMO}, 'DEMO-R', 'DEMO - Reset University', true, true),
      (${OTHER}, 'REAL-R', 'Real University', true, false)
  `);
  process.env['DEMO_DATA_ENABLED'] = 'true';
  process.env['DEMO_RESET_ALLOWED'] = 'true';
}, 240_000);

afterAll(async () => {
  delete process.env['DEMO_DATA_ENABLED'];
  delete process.env['DEMO_RESET_ALLOWED'];
  await container?.stop();
});

const reset = () => resetScenario({ databaseUrl: container.getConnectionUri(), tenantId: DEMO, scenarioSlug: 'ci-golden' });

/** Records a demo session leaves behind in tables the scenarios never load, several append-only. */
async function leaveSessionData(tenantId: string, tag: string): Promise<void> {
  const enrolmentId = GOLDEN_IDS.ENROLMENT_ENROLLED;
  const personId = GOLDEN_IDS.PERSON_ENROLLED;
  await db.execute(sql`
    WITH payload AS (
      INSERT INTO application_received_payload (tenant_id, channel_code, source_reference, cycle, payload, payload_hash, received_by)
      VALUES (${tenantId}, 'ucas', ${`REF-${tag}`}, '2027', '{}'::jsonb, ${`hash-${tag}`}, 'test') RETURNING id
    )
    INSERT INTO student_application (tenant_id, channel_code, source_reference, cycle, identity_match_code, latest_payload_id, status_code)
    SELECT ${tenantId}, 'ucas', ${`REF-${tag}`}, '2027', 'needs-review', id, 'incomplete' FROM payload
  `);
  await db.execute(sql`
    WITH rec AS (
      INSERT INTO award_recommendation (tenant_id, enrolment_id, person_id, award_type_code, qualification_code, classification_code, recommended_by, status_code)
      VALUES (${tenantId}, ${enrolmentId}, ${personId}, 'standard', 'BSc (Hons)', '2:1', 'test', 'conferred') RETURNING id
    )
    INSERT INTO award_conferment (tenant_id, recommendation_id, award_id, conferment_date, authority_ref, conferred_by)
    SELECT ${tenantId}, id, gen_random_uuid(), '2027-07-01', 'Senate', 'test' FROM rec
  `);
  await db.execute(sql`
    INSERT INTO rule_exception (tenant_id, enrolment_id, rule_code, exception_type_code, description, valid_from, created_by)
    VALUES (${tenantId}, ${enrolmentId}, 'max-credits-per-period', 'waiver', 'Session waiver', '2026-09-01', 'test')
  `);
}

async function count(table: string, tenantId: string): Promise<number> {
  const [schema, name] = table.split('.') as [string, string];
  const rows = (await db.execute(sql`SELECT count(*)::int AS n FROM ${sql.identifier(schema)}.${sql.identifier(name)} WHERE tenant_id = ${tenantId}`)) as unknown as Array<{ n: number }>;
  return rows[0]!.n;
}

describe('demo reset', () => {
  it('lists only real tables as preserved', async () => {
    const rows = (await db.execute(sql`
      SELECT n.nspname || '.' || c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.relkind IN ('r', 'p')
    `)) as unknown as Array<{ name: string }>;
    const tables = new Set(rows.map((r) => r.name));
    expect([...PRESERVED_TENANT_TABLES.keys()].filter((t) => !tables.has(t))).toEqual([]);
  });

  it('wipes every non-preserved tenant table, append-only ones included, and leaves other tenants alone', async () => {
    await reset();
    await leaveSessionData(DEMO, 'demo');
    await leaveSessionData(OTHER, 'other');
    const programmesBefore = await count('public.programme', DEMO);
    expect(programmesBefore).toBeGreaterThan(0);

    await reset();

    // Session data in tables the scenario does not load is gone.
    for (const table of ['public.student_application', 'public.application_received_payload', 'public.award_conferment', 'public.award_recommendation', 'public.rule_exception']) {
      expect({ table, rows: await count(table, DEMO) }).toEqual({ table, rows: 0 });
    }
    // Preserved reference data survives; the other tenant is untouched.
    expect(await count('public.programme', DEMO)).toBe(programmesBefore);
    for (const table of ['public.student_application', 'public.award_conferment', 'public.rule_exception']) {
      expect(await count(table, OTHER)).toBe(1);
    }
    // The append-only guard is back on after the reset.
    await expect(db.execute(sql`DELETE FROM award_conferment WHERE tenant_id = ${OTHER}`))
      .rejects.toMatchObject({ cause: { message: expect.stringMatching(/append-only/) as unknown } });
  });

  it('a wipe alone leaves no rows in any non-preserved table', async () => {
    const { wipeTenantScenarioData } = await import('../src/reset.js');
    await leaveSessionData(DEMO, 'again');
    await wipeTenantScenarioData(db, DEMO);
    const leftovers: string[] = [];
    for (const table of await tenantTablesToWipe(db)) {
      if ((await count(table.name, DEMO)) > 0) leftovers.push(table.name);
    }
    expect(leftovers).toEqual([]);
  });
});
