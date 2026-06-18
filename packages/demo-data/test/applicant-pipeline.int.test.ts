import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createDb,
  personIdentities,
  persons,
  ucasApplications,
  type Db,
} from '@revelation-srs/db';

import {
  personId,
  ucasPersonalId,
} from '../src/generators/persons.js';
import { resetScenario } from '../src/reset.js';
import { manifest } from '../src/scenarios/applicant-pipeline.js';

import { applyAllMigrations } from './helpers/migrations.js';

const DEMO_TENANT_ID = 'a1000000-0000-4000-8000-000000000001';

let container: StartedPostgreSqlContainer;
let db: Db;
let loadMs: number;

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase('srs_s1_test')
    .start();

  db = createDb(container.getConnectionUri());
  await applyAllMigrations(db);

  await db.execute(sql`
    UPDATE deployment_environment SET active = false WHERE production_like = true
  `);

  await db.execute(sql`
    INSERT INTO tenant (id, code, name, active, demo_mode)
    VALUES (${DEMO_TENANT_ID}, 'S1DEMO', 'DEMO - S1 Applicant Pipeline', true, true)
  `);

  process.env['DEMO_DATA_ENABLED']  = 'true';
  process.env['DEMO_RESET_ALLOWED'] = 'true';

  const t0 = Date.now();
  await resetScenario({
    databaseUrl:  container.getConnectionUri(),
    tenantId:     DEMO_TENANT_ID,
    scenarioSlug: 'applicant-pipeline',
  });
  loadMs = Date.now() - t0;
}, 180_000);

afterAll(async () => {
  delete process.env['DEMO_DATA_ENABLED'];
  delete process.env['DEMO_RESET_ALLOWED'];
  await container.stop();
});

// ─── Load time ────────────────────────────────────────────────────────────────

describe('Applicant Pipeline load time', () => {
  it('loads within 5-minute budget', () => {
    expect(loadMs).toBeLessThan(manifest.loadTimeBudgetMs);
  });
});

// ─── Total applicant count ────────────────────────────────────────────────────

describe('Applicant counts', () => {
  it('loads all 600 applicants', async () => {
    const rows = await db
      .select({ id: persons.id })
      .from(persons)
      .where(eq(persons.tenantId, DEMO_TENANT_ID));
    expect(rows).toHaveLength(600);
  });

  it('all applicants have prospective status', async () => {
    const rows = await db
      .select({ statusCode: persons.personStatusCode })
      .from(persons)
      .where(eq(persons.tenantId, DEMO_TENANT_ID));
    for (const r of rows) {
      expect(r.statusCode).toBe('prospective');
    }
  });

  it('loads approximately 420 UCAS applications (within ±30)', async () => {
    const rows = await db
      .select({ id: ucasApplications.id })
      .from(ucasApplications)
      .where(eq(ucasApplications.tenantId, DEMO_TENANT_ID));
    expect(rows.length).toBeGreaterThanOrEqual(390);
    expect(rows.length).toBeLessThanOrEqual(450);
  });

  it('all applicants have a person identity', async () => {
    const pRows = await db
      .select({ id: persons.id })
      .from(persons)
      .where(eq(persons.tenantId, DEMO_TENANT_ID));
    const iRows = await db
      .select({ personId: personIdentities.personId })
      .from(personIdentities)
      .where(eq(personIdentities.tenantId, DEMO_TENANT_ID));
    expect(iRows).toHaveLength(pRows.length);
  });
});

// ─── Story markers ────────────────────────────────────────────────────────────

describe('S1 story-marker persons', () => {
  it('alice (seq 1) exists as a prospective UCAS applicant', async () => {
    const aliceId = personId(DEMO_TENANT_ID, 1);
    const rows = await db
      .select({ id: persons.id, sourceSystem: persons.sourceSystem, statusCode: persons.personStatusCode })
      .from(persons)
      .where(eq(persons.id, aliceId));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.sourceSystem).toBe('ucas');
    expect(rows[0]!.statusCode).toBe('prospective');
  });

  it('bob (seq 2) exists as a direct applicant', async () => {
    const bobId = personId(DEMO_TENANT_ID, 2);
    const rows = await db
      .select({ sourceSystem: persons.sourceSystem })
      .from(persons)
      .where(eq(persons.id, bobId));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.sourceSystem).toBe('direct');
  });

  it('carol (seq 3) exists as an international applicant', async () => {
    const carolId = personId(DEMO_TENANT_ID, 3);
    const rows = await db
      .select({ sourceSystem: persons.sourceSystem })
      .from(persons)
      .where(eq(persons.id, carolId));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.sourceSystem).toBe('international');
  });

  it('alice has a UCAS application with conditional status', async () => {
    const rows = await db
      .select({ statusCode: ucasApplications.statusCode, ucasPersonalId: ucasApplications.ucasPersonalId })
      .from(ucasApplications)
      .where(eq(ucasApplications.tenantId, DEMO_TENANT_ID))
      .limit(50);
    const aliceApp = rows.find(r => r.ucasPersonalId === ucasPersonalId(1));
    expect(aliceApp).toBeDefined();
    expect(aliceApp!.statusCode).toBe('conditional');
  });
});

// ─── Offer status distribution ────────────────────────────────────────────────

describe('UCAS offer status distribution', () => {
  it('has multiple distinct offer statuses', async () => {
    const rows = await db
      .select({ statusCode: ucasApplications.statusCode })
      .from(ucasApplications)
      .where(eq(ucasApplications.tenantId, DEMO_TENANT_ID));
    const statuses = new Set(rows.map(r => r.statusCode));
    expect(statuses.size).toBeGreaterThanOrEqual(4);
  });
});

// ─── Fictional data compliance ────────────────────────────────────────────────

describe('Fictional data compliance', () => {
  it('institutional emails use @demo.srs domain', async () => {
    const rows = await db
      .select({ email: personIdentities.emailInstitutional })
      .from(personIdentities)
      .where(eq(personIdentities.tenantId, DEMO_TENANT_ID))
      .limit(100);
    for (const r of rows) {
      expect(r.email).toMatch(/@demo\.srs$/);
    }
  });

  it('legal first names carry DEMO - prefix', async () => {
    const rows = await db
      .select({ name: personIdentities.legalFirstName })
      .from(personIdentities)
      .where(eq(personIdentities.tenantId, DEMO_TENANT_ID))
      .limit(100);
    for (const r of rows) {
      expect(r.name).toMatch(/^DEMO - /);
    }
  });

  it('student numbers start with SN', async () => {
    const rows = await db
      .select({ sn: persons.studentNumber })
      .from(persons)
      .where(eq(persons.tenantId, DEMO_TENANT_ID))
      .limit(100);
    for (const r of rows) {
      expect(r.sn).toMatch(/^SN/);
    }
  });
});

// ─── Idempotency ──────────────────────────────────────────────────────────────

describe('Idempotency', () => {
  it('second load keeps applicant count stable', async () => {
    const before = await db
      .select({ id: persons.id })
      .from(persons)
      .where(eq(persons.tenantId, DEMO_TENANT_ID));

    await resetScenario({
      databaseUrl:  container.getConnectionUri(),
      tenantId:     DEMO_TENANT_ID,
      scenarioSlug: 'applicant-pipeline',
    });

    const after = await db
      .select({ id: persons.id })
      .from(persons)
      .where(eq(persons.tenantId, DEMO_TENANT_ID));

    expect(after.length).toBe(before.length);
  });
});
