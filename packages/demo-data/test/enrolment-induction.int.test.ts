import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createDb,
  enrolments,
  feeLiabilities,
  personIdentities,
  persons,
  slcNotifications,
  ukviCasRequests,
  type Db,
} from '@revelation-srs/db';

import { personId } from '../src/generators/persons.js';
import { resetScenario } from '../src/reset.js';
import { manifest } from '../src/scenarios/enrolment-induction.js';

import { applyAllMigrations } from './helpers/migrations.js';

const DEMO_TENANT_ID = 'a2000000-0000-4000-8000-000000000001';

let container: StartedPostgreSqlContainer;
let db: Db;
let loadMs: number;

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase('srs_s2_test')
    .start();

  db = createDb(container.getConnectionUri());
  await applyAllMigrations(db);

  await db.execute(sql`
    UPDATE deployment_environment SET active = false WHERE production_like = true
  `);

  await db.execute(sql`
    INSERT INTO tenant (id, code, name, active, demo_mode)
    VALUES (${DEMO_TENANT_ID}, 'S2DEMO', 'DEMO - S2 Enrolment Induction', true, true)
  `);

  process.env['DEMO_DATA_ENABLED']  = 'true';
  process.env['DEMO_RESET_ALLOWED'] = 'true';

  const t0 = Date.now();
  await resetScenario({
    databaseUrl:  container.getConnectionUri(),
    tenantId:     DEMO_TENANT_ID,
    scenarioSlug: 'enrolment-induction',
  });
  loadMs = Date.now() - t0;
}, 180_000);

afterAll(async () => {
  delete process.env['DEMO_DATA_ENABLED'];
  delete process.env['DEMO_RESET_ALLOWED'];
  await container.stop();
});

// ─── Load time ────────────────────────────────────────────────────────────────

describe('Enrolment Induction load time', () => {
  it('loads within 5-minute budget', () => {
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

  it('loads all 1,000 enrolments', async () => {
    const rows = await db
      .select({ id: enrolments.id })
      .from(enrolments)
      .where(eq(enrolments.tenantId, DEMO_TENANT_ID));
    expect(rows).toHaveLength(1_000);
  });

  it('loads fee liabilities for non-withdrawn students', async () => {
    const rows = await db
      .select({ id: feeLiabilities.id })
      .from(feeLiabilities)
      .where(eq(feeLiabilities.tenantId, DEMO_TENANT_ID));
    // At least 75% of students should have fee liabilities (all except withdrawn ~10%)
    expect(rows.length).toBeGreaterThan(700);
  });

  it('all persons have an identity record', async () => {
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

// ─── Enrolment status distribution ───────────────────────────────────────────

describe('Enrolment status distribution', () => {
  it('has all four statuses present', async () => {
    const rows = await db
      .select({ statusCode: enrolments.statusCode })
      .from(enrolments)
      .where(eq(enrolments.tenantId, DEMO_TENANT_ID));
    const statuses = new Set(rows.map(r => r.statusCode));
    expect(statuses.has('enrolled')).toBe(true);
    expect(statuses.has('intermitting')).toBe(true);
    expect(statuses.has('withdrawn')).toBe(true);
    expect(statuses.has('graduated')).toBe(true);
  });

  it('enrolled is the dominant status (at least 60%)', async () => {
    const rows = await db
      .select({ statusCode: enrolments.statusCode })
      .from(enrolments)
      .where(eq(enrolments.tenantId, DEMO_TENANT_ID));
    const enrolled = rows.filter(r => r.statusCode === 'enrolled').length;
    expect(enrolled).toBeGreaterThan(600);
  });
});

// ─── Story markers ────────────────────────────────────────────────────────────

describe('S2 story-marker persons', () => {
  it('alice (seq 1) is enrolled', async () => {
    const aliceId = personId(DEMO_TENANT_ID, 1);
    const rows = await db
      .select({ statusCode: enrolments.statusCode, modeOfStudyCode: enrolments.modeOfStudyCode })
      .from(enrolments)
      .where(eq(enrolments.tenantId, DEMO_TENANT_ID));
    const _aliceEnrolment = rows.find(_r => {
      // find by checking person person table
      return true; // We'll check via person id below
    });
    // Check via person status
    const personRows = await db
      .select({ statusCode: persons.personStatusCode })
      .from(persons)
      .where(eq(persons.id, aliceId));
    expect(personRows).toHaveLength(1);
    expect(personRows[0]!.statusCode).toBe('enrolled');
  });

  it('bob (seq 2) is intermitting', async () => {
    const bobId = personId(DEMO_TENANT_ID, 2);
    const rows = await db
      .select({ statusCode: persons.personStatusCode })
      .from(persons)
      .where(eq(persons.id, bobId));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.statusCode).toBe('intermitting');
  });

  it('carol (seq 3) is graduated', async () => {
    const carolId = personId(DEMO_TENANT_ID, 3);
    const rows = await db
      .select({ statusCode: persons.personStatusCode })
      .from(persons)
      .where(eq(persons.id, carolId));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.statusCode).toBe('graduated');
  });

  it('alice has an enrolment in enrolled status', async () => {
    const aliceId = personId(DEMO_TENANT_ID, 1);
    const rows = await db
      .select({ statusCode: enrolments.statusCode })
      .from(enrolments)
      .where(eq(enrolments.personId, aliceId));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.statusCode).toBe('enrolled');
  });
});

// ─── Regulatory data ──────────────────────────────────────────────────────────

describe('Regulatory data', () => {
  it('has SLC notifications for domestic students', async () => {
    const rows = await db
      .select({ id: slcNotifications.id })
      .from(slcNotifications)
      .where(eq(slcNotifications.tenantId, DEMO_TENANT_ID));
    expect(rows.length).toBeGreaterThan(0);
  });

  it('has UKVI CAS requests for international students', async () => {
    const rows = await db
      .select({ id: ukviCasRequests.id })
      .from(ukviCasRequests)
      .where(eq(ukviCasRequests.tenantId, DEMO_TENANT_ID));
    // seq%25===0 gives 40 intl students; 25n%20 cycles {5,10,15,0} so 3/4 are active → ~30
    expect(rows.length).toBeGreaterThan(20);
    expect(rows.length).toBeLessThan(40);
  });

  it('UKVI CAS references are prefixed DEMO-CAS-', async () => {
    const rows = await db
      .select({ casReference: ukviCasRequests.casReference })
      .from(ukviCasRequests)
      .where(eq(ukviCasRequests.tenantId, DEMO_TENANT_ID))
      .limit(10);
    for (const r of rows) {
      if (r.casReference) {
        expect(r.casReference).toMatch(/^DEMO-CAS-/);
      }
    }
  });
});

// ─── Fictional data compliance ────────────────────────────────────────────────

describe('Fictional data compliance', () => {
  it('institutional emails use @demo.srs domain', async () => {
    const rows = await db
      .select({ email: personIdentities.emailInstitutional })
      .from(personIdentities)
      .where(eq(personIdentities.tenantId, DEMO_TENANT_ID))
      .limit(200);
    for (const r of rows) {
      expect(r.email).toMatch(/@demo\.srs$/);
    }
  });

  it('legal first names carry DEMO - prefix', async () => {
    const rows = await db
      .select({ name: personIdentities.legalFirstName })
      .from(personIdentities)
      .where(eq(personIdentities.tenantId, DEMO_TENANT_ID))
      .limit(200);
    for (const r of rows) {
      expect(r.name).toMatch(/^DEMO - /);
    }
  });
});

// ─── Idempotency ──────────────────────────────────────────────────────────────

describe('Idempotency', () => {
  it('second load keeps person count stable', async () => {
    const before = await db
      .select({ id: persons.id })
      .from(persons)
      .where(eq(persons.tenantId, DEMO_TENANT_ID));

    await resetScenario({
      databaseUrl:  container.getConnectionUri(),
      tenantId:     DEMO_TENANT_ID,
      scenarioSlug: 'enrolment-induction',
    });

    const after = await db
      .select({ id: persons.id })
      .from(persons)
      .where(eq(persons.tenantId, DEMO_TENANT_ID));

    expect(after.length).toBe(before.length);
  });
});
