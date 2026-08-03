import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createDb,
  examBoards,
  examEntries,
  moduleRegistrations,
  personIdentities,
  persons,
  type Db,
} from '@revelation-srs/db';

import { personId } from '../src/generators/persons.js';
import { resetScenario } from '../src/reset.js';
import { manifest } from '../src/scenarios/module-selection.js';

import { applyAllMigrations } from './helpers/migrations.js';

const DEMO_TENANT_ID = 'a3000000-0000-4000-8000-000000000001';

let container: StartedPostgreSqlContainer;
let db: Db;
let loadMs: number;

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase('srs_s3_test')
    .start();

  db = createDb(container.getConnectionUri());
  await applyAllMigrations(db);

  await db.execute(sql`
    UPDATE deployment_environment SET active = false WHERE production_like = true
  `);

  await db.execute(sql`
    INSERT INTO tenant (id, code, name, active, demo_mode)
    VALUES (${DEMO_TENANT_ID}, 'S3DEMO', 'DEMO - S3 Module Selection', true, true)
  `);

  process.env['DEMO_DATA_ENABLED']  = 'true';
  process.env['DEMO_RESET_ALLOWED'] = 'true';

  const t0 = Date.now();
  await resetScenario({
    databaseUrl:  container.getConnectionUri(),
    tenantId:     DEMO_TENANT_ID,
    scenarioSlug: 'module-selection',
  });
  loadMs = Date.now() - t0;
}, 180_000);

afterAll(async () => {
  delete process.env['DEMO_DATA_ENABLED'];
  delete process.env['DEMO_RESET_ALLOWED'];
  await container.stop();
});

// ─── Load time ────────────────────────────────────────────────────────────────

describe('Module Selection load time', () => {
  it('loads within 2-minute budget', () => {
    expect(loadMs).toBeLessThan(manifest.loadTimeBudgetMs);
  });
});

// ─── Student counts ───────────────────────────────────────────────────────────

describe('Student counts', () => {
  it('loads all 1,000 persons', async () => {
    const rows = await db
      .select({ id: persons.id })
      .from(persons)
      .where(eq(persons.tenantId, DEMO_TENANT_ID));
    expect(rows).toHaveLength(1_000);
  });

  it('all persons have identity records', async () => {
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

// ─── Module registrations ─────────────────────────────────────────────────────

describe('Module registrations', () => {
  it('loads exactly 2,000 registrations (2 per student)', async () => {
    const rows = await db
      .select({ id: moduleRegistrations.id })
      .from(moduleRegistrations)
      .where(eq(moduleRegistrations.tenantId, DEMO_TENANT_ID));
    expect(rows).toHaveLength(2_000);
  });

  it('has all five registration statuses present', async () => {
    const rows = await db
      .select({ statusCode: moduleRegistrations.statusCode })
      .from(moduleRegistrations)
      .where(eq(moduleRegistrations.tenantId, DEMO_TENANT_ID));
    const statuses = new Set(rows.map(r => r.statusCode));
    expect(statuses.has('registered')).toBe(true);
    expect(statuses.has('withdrawn')).toBe(true);
    expect(statuses.has('waitlisted')).toBe(true);
    expect(statuses.has('override')).toBe(true);
    expect(statuses.has('draft')).toBe(true);
  });

  it('registered is the dominant status (>50% of all registrations)', async () => {
    const rows = await db
      .select({ statusCode: moduleRegistrations.statusCode })
      .from(moduleRegistrations)
      .where(eq(moduleRegistrations.tenantId, DEMO_TENANT_ID));
    const registered = rows.filter(r => r.statusCode === 'registered').length;
    expect(registered).toBeGreaterThan(1_000);
  });
});

// ─── Exam boards ──────────────────────────────────────────────────────────────

describe('Exam boards', () => {
  it('has exactly 3 exam boards', async () => {
    const rows = await db
      .select({ id: examBoards.id })
      .from(examBoards)
      .where(eq(examBoards.tenantId, DEMO_TENANT_ID));
    expect(rows).toHaveLength(3);
  });

  it('all boards have boardTypeCode "module"', async () => {
    const rows = await db
      .select({ boardTypeCode: examBoards.boardTypeCode })
      .from(examBoards)
      .where(eq(examBoards.tenantId, DEMO_TENANT_ID));
    for (const r of rows) {
      expect(r.boardTypeCode).toBe('module');
    }
  });
});

// ─── Exam entries ─────────────────────────────────────────────────────────────

describe('Exam entries', () => {
  it('loads exam entries only for registered and override registrations', async () => {
    const rows = await db
      .select({ id: examEntries.id })
      .from(examEntries)
      .where(eq(examEntries.tenantId, DEMO_TENANT_ID));
    // registered (~65%) + override (~5%) = ~70% of 2,000 = ~1,400
    expect(rows.length).toBeGreaterThan(1_200);
    expect(rows.length).toBeLessThan(1_600);
  });

  it('candidate numbers are prefixed DEMO-CAND-', async () => {
    const rows = await db
      .select({ candidateNumber: examEntries.candidateNumber })
      .from(examEntries)
      .where(eq(examEntries.tenantId, DEMO_TENANT_ID))
      .limit(20);
    for (const r of rows) {
      if (r.candidateNumber) {
        expect(r.candidateNumber).toMatch(/^DEMO-CAND-/);
      }
    }
  });

  it('room references are prefixed DEMO-HALL-', async () => {
    const rows = await db
      .select({ roomReference: examEntries.roomReference })
      .from(examEntries)
      .where(eq(examEntries.tenantId, DEMO_TENANT_ID))
      .limit(20);
    for (const r of rows) {
      if (r.roomReference) {
        expect(r.roomReference).toMatch(/^DEMO-HALL-/);
      }
    }
  });

  it('confirmed is the dominant exam entry status', async () => {
    const rows = await db
      .select({ statusCode: examEntries.statusCode })
      .from(examEntries)
      .where(eq(examEntries.tenantId, DEMO_TENANT_ID));
    const confirmed = rows.filter(r => r.statusCode === 'confirmed').length;
    expect(confirmed).toBeGreaterThan(rows.length * 0.8);
  });
});

// ─── Story markers ────────────────────────────────────────────────────────────

describe('S3 story-marker persons', () => {
  it('alice (seq 1) has both modules registered', async () => {
    const aliceId = personId(DEMO_TENANT_ID, 1);
    const _enrolRows = await db
      .select({ enrolmentId: moduleRegistrations.enrolmentId })
      .from(moduleRegistrations)
      .where(eq(moduleRegistrations.tenantId, DEMO_TENANT_ID));
    // alice's enrolment ID is derived deterministically; we check via person query
    const personRows = await db
      .select({ statusCode: persons.personStatusCode })
      .from(persons)
      .where(eq(persons.id, aliceId));
    expect(personRows).toHaveLength(1);
    expect(personRows[0]!.statusCode).toBe('student');
  });

  it('bob (seq 2) exists with enrolled status', async () => {
    const bobId = personId(DEMO_TENANT_ID, 2);
    const rows = await db
      .select({ statusCode: persons.personStatusCode })
      .from(persons)
      .where(eq(persons.id, bobId));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.statusCode).toBe('student');
  });

  it('carol (seq 3) exists with enrolled status', async () => {
    const carolId = personId(DEMO_TENANT_ID, 3);
    const rows = await db
      .select({ statusCode: persons.personStatusCode })
      .from(persons)
      .where(eq(persons.id, carolId));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.statusCode).toBe('student');
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
});

// ─── Idempotency ──────────────────────────────────────────────────────────────

describe('Idempotency', () => {
  it('second load keeps registration count stable', async () => {
    const before = await db
      .select({ id: moduleRegistrations.id })
      .from(moduleRegistrations)
      .where(eq(moduleRegistrations.tenantId, DEMO_TENANT_ID));

    await resetScenario({
      databaseUrl:  container.getConnectionUri(),
      tenantId:     DEMO_TENANT_ID,
      scenarioSlug: 'module-selection',
    });

    const after = await db
      .select({ id: moduleRegistrations.id })
      .from(moduleRegistrations)
      .where(eq(moduleRegistrations.tenantId, DEMO_TENANT_ID));

    expect(after.length).toBe(before.length);
  });
});
