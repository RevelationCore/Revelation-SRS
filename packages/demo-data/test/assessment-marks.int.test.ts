import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  assessmentComponents,
  enrolments,
  integrationExchanges,
  integrationRegistrations,
  marks,
  moduleRegistrations,
  moduleResults,
  personIdentities,
  persons,
  reasonableAdjustments,
  type Db,
} from '@revelation-srs/db';
import { createDb } from '@revelation-srs/db';

import { personId } from '../src/generators/persons.js';
import { resetScenario } from '../src/reset.js';
import { manifest } from '../src/scenarios/assessment-marks.js';

import { applyAllMigrations } from './helpers/migrations.js';

const DEMO_TENANT_ID = 'a4000000-0000-4000-8000-000000000001';

let container: StartedPostgreSqlContainer;
let db: Db;
let loadMs: number;

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase('srs_s4_test')
    .start();

  db = createDb(container.getConnectionUri());
  await applyAllMigrations(db);

  await db.execute(sql`
    UPDATE deployment_environment SET active = false WHERE production_like = true
  `);

  await db.execute(sql`
    INSERT INTO tenant (id, code, name, active, demo_mode)
    VALUES (${DEMO_TENANT_ID}, 'S4DEMO', 'DEMO - S4 Assessment Marks', true, true)
  `);

  process.env['DEMO_DATA_ENABLED']  = 'true';
  process.env['DEMO_RESET_ALLOWED'] = 'true';

  const t0 = Date.now();
  await resetScenario({
    databaseUrl:  container.getConnectionUri(),
    tenantId:     DEMO_TENANT_ID,
    scenarioSlug: 'assessment-marks',
  });
  loadMs = Date.now() - t0;
}, 240_000);

afterAll(async () => {
  delete process.env['DEMO_DATA_ENABLED'];
  delete process.env['DEMO_RESET_ALLOWED'];
  await container.stop();
});

// ─── Load time ────────────────────────────────────────────────────────────────

describe('Assessment Marks load time', () => {
  it('loads within budget', () => {
    expect(loadMs).toBeLessThan(manifest.loadTimeBudgetMs);
  });
});

// ─── Student counts ───────────────────────────────────────────────────────────

describe('Student counts', () => {
  it('loads exactly 1,000 persons', async () => {
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

  it('loads exactly 1,000 enrolments', async () => {
    const rows = await db
      .select({ id: enrolments.id })
      .from(enrolments)
      .where(eq(enrolments.tenantId, DEMO_TENANT_ID));
    expect(rows).toHaveLength(1_000);
  });
});

// ─── Module registrations ─────────────────────────────────────────────────────

describe('Module registrations', () => {
  it('enrolled students have registrations', async () => {
    const rows = await db
      .select({ id: moduleRegistrations.id })
      .from(moduleRegistrations)
      .where(eq(moduleRegistrations.tenantId, DEMO_TENANT_ID));
    // ~65% enrolled × 1,000 × 2 slots = ~1,300 registrations
    expect(rows.length).toBeGreaterThan(1_000);
    expect(rows.length).toBeLessThanOrEqual(2_000);
  });
});

// ─── Assessment components ────────────────────────────────────────────────────

describe('Assessment components', () => {
  it('has 2 components (coursework + exam) per module offering', async () => {
    const rows = await db
      .select({ id: assessmentComponents.id })
      .from(assessmentComponents)
      .where(eq(assessmentComponents.tenantId, DEMO_TENANT_ID));
    // 39-40 module offerings per year × 2 components each
    expect(rows.length).toBeGreaterThanOrEqual(76);
    expect(rows.length % 2).toBe(0);
  });

  it('has only coursework and exam component types', async () => {
    const rows = await db
      .select({ typeCode: assessmentComponents.componentTypeCode })
      .from(assessmentComponents)
      .where(eq(assessmentComponents.tenantId, DEMO_TENANT_ID));
    const types = new Set(rows.map(r => r.typeCode));
    expect(types).toEqual(new Set(['coursework', 'exam']));
  });

  it('weightings sum to 100 per module offering', async () => {
    const rows = await db.execute(
      sql`SELECT SUM(weighting) AS total
          FROM assessment_component
          WHERE tenant_id = ${DEMO_TENANT_ID}
          GROUP BY module_offering_id`,
    ) as Array<{ total: string }>;
    for (const r of rows) {
      expect(parseInt(r.total, 10)).toBe(100);
    }
  });
});

// ─── Marks ────────────────────────────────────────────────────────────────────

describe('Marks', () => {
  it('has marks only for registered/override registrations', async () => {
    const markRows = await db
      .select({ id: marks.id })
      .from(marks)
      .where(eq(marks.tenantId, DEMO_TENANT_ID));
    // ~70% of enrolled registrations get marks, 2 components each
    // enrolled ~65% of 1,000 = 650 students × 2 slots = 1,300 registrations
    // ~70% are registered/override = ~910 × 2 components = ~1,820 marks
    expect(markRows.length).toBeGreaterThan(1_500);
    expect(markRows.length).toBeLessThan(3_000);
  });

  it('all marks have rawMark equal to adjustedMark (no penalties)', async () => {
    const rows = await db
      .select({ raw: marks.rawMark, adj: marks.adjustedMark })
      .from(marks)
      .where(eq(marks.tenantId, DEMO_TENANT_ID))
      .limit(200);
    for (const r of rows) {
      expect(r.raw).toBe(r.adj);
    }
  });

  it('marks are in the range 30–85', async () => {
    const rows = await db
      .select({ rawMark: marks.rawMark })
      .from(marks)
      .where(eq(marks.tenantId, DEMO_TENANT_ID))
      .limit(200);
    for (const r of rows) {
      const v = parseFloat(r.rawMark);
      expect(v).toBeGreaterThanOrEqual(30);
      expect(v).toBeLessThanOrEqual(85);
    }
  });

  it('marks are all unlocked', async () => {
    const rows = await db
      .select({ locked: marks.locked })
      .from(marks)
      .where(eq(marks.tenantId, DEMO_TENANT_ID))
      .limit(200);
    for (const r of rows) {
      expect(r.locked).toBe(false);
    }
  });
});

// ─── Module results ───────────────────────────────────────────────────────────

describe('Module results', () => {
  it('has module results for registered/override registrations', async () => {
    const rows = await db
      .select({ id: moduleResults.id })
      .from(moduleResults)
      .where(eq(moduleResults.tenantId, DEMO_TENANT_ID));
    expect(rows.length).toBeGreaterThan(700);
  });

  it('result codes are valid', async () => {
    const rows = await db
      .select({ resultCode: moduleResults.resultCode })
      .from(moduleResults)
      .where(eq(moduleResults.tenantId, DEMO_TENANT_ID))
      .limit(200);
    const validCodes = new Set(['pass', 'fail', 'compensated']);
    for (const r of rows) {
      expect(validCodes.has(r.resultCode)).toBe(true);
    }
  });

  it('pass is the dominant result', async () => {
    const rows = await db
      .select({ resultCode: moduleResults.resultCode })
      .from(moduleResults)
      .where(eq(moduleResults.tenantId, DEMO_TENANT_ID));
    const passes = rows.filter(r => r.resultCode === 'pass').length;
    expect(passes).toBeGreaterThan(rows.length * 0.5);
  });
});

// ─── Wellbeing — SRS reasonable adjustments ──────────────────────────────────

describe('Reasonable adjustments (SRS-side)', () => {
  it('has ~20 reasonable adjustment records', async () => {
    const rows = await db
      .select({ id: reasonableAdjustments.id })
      .from(reasonableAdjustments)
      .where(eq(reasonableAdjustments.tenantId, DEMO_TENANT_ID));
    // ~20 wellbeing cases among enrolled students (seq % 50 === 0 among ~650 enrolled)
    expect(rows.length).toBeGreaterThan(5);
    expect(rows.length).toBeLessThan(50);
  });

  it('all adjustment notes carry DEMO prefix', async () => {
    const rows = await db
      .select({ notes: reasonableAdjustments.notes })
      .from(reasonableAdjustments)
      .where(eq(reasonableAdjustments.tenantId, DEMO_TENANT_ID))
      .limit(30);
    for (const r of rows) {
      if (r.notes) {
        expect(r.notes).toContain('DEMO - ');
      }
    }
  });

  it('all adjustments are unlocked (no valid_to)', async () => {
    const rows = await db
      .select({ validTo: reasonableAdjustments.validTo })
      .from(reasonableAdjustments)
      .where(eq(reasonableAdjustments.tenantId, DEMO_TENANT_ID));
    for (const r of rows) {
      expect(r.validTo).toBeNull();
    }
  });
});

// ─── Wellbeing schema ─────────────────────────────────────────────────────────

describe('Wellbeing schema records', () => {
  it('wellbeing schema exists', async () => {
    const rows = await db.execute(
      sql`SELECT 1 FROM information_schema.schemata WHERE schema_name = 'wellbeing' LIMIT 1`,
    ) as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
  });

  it('has wellbeing cases', async () => {
    const rows = await db.execute(
      sql`SELECT id FROM wellbeing.wellbeing_case WHERE tenant_id = ${DEMO_TENANT_ID}`,
    ) as Array<{ id: string }>;
    expect(rows.length).toBeGreaterThan(5);
    expect(rows.length).toBeLessThan(50);
  });

  it('all wellbeing case refs start with DEMO-WB-', async () => {
    const rows = await db.execute(
      sql`SELECT case_ref FROM wellbeing.wellbeing_case WHERE tenant_id = ${DEMO_TENANT_ID} LIMIT 10`,
    ) as Array<{ case_ref: string }>;
    for (const r of rows) {
      expect(r.case_ref).toMatch(/^DEMO-WB-/);
    }
  });

  it('has disability support cases', async () => {
    const rows = await db.execute(
      sql`SELECT id FROM wellbeing.disability_support_case WHERE tenant_id = ${DEMO_TENANT_ID}`,
    ) as Array<{ id: string }>;
    expect(rows.length).toBeGreaterThan(5);
  });

  it('has adjustment cases', async () => {
    const rows = await db.execute(
      sql`SELECT id FROM wellbeing.adjustment_case WHERE tenant_id = ${DEMO_TENANT_ID}`,
    ) as Array<{ id: string }>;
    expect(rows.length).toBeGreaterThan(5);
  });

  it('has EC claims', async () => {
    const rows = await db.execute(
      sql`SELECT id FROM wellbeing.ec_claim WHERE tenant_id = ${DEMO_TENANT_ID}`,
    ) as Array<{ id: string }>;
    // seq % 200 === 0 among 650 enrolled + bob story marker
    expect(rows.length).toBeGreaterThanOrEqual(1);
  });

  it('EC claim narratives carry DEMO prefix', async () => {
    const rows = await db.execute(
      sql`SELECT circumstances_narrative FROM wellbeing.ec_claim WHERE tenant_id = ${DEMO_TENANT_ID} LIMIT 5`,
    ) as Array<{ circumstances_narrative: string | null }>;
    for (const r of rows) {
      if (r.circumstances_narrative) {
        expect(r.circumstances_narrative).toContain('DEMO - ');
      }
    }
  });
});

// ─── VLE integration ──────────────────────────────────────────────────────────

describe('VLE integration', () => {
  it('has a VLE integration registration', async () => {
    const rows = await db
      .select({ id: integrationRegistrations.id })
      .from(integrationRegistrations)
      .where(eq(integrationRegistrations.tenantId, DEMO_TENANT_ID));
    expect(rows.length).toBe(1);
  });

  it('the VLE registration is enabled', async () => {
    const rows = await db
      .select({ enabled: integrationRegistrations.enabled })
      .from(integrationRegistrations)
      .where(eq(integrationRegistrations.tenantId, DEMO_TENANT_ID));
    expect(rows[0]!.enabled).toBe(true);
  });

  it('has VLE exchange records for mark submissions', async () => {
    const rows = await db
      .select({ id: integrationExchanges.id })
      .from(integrationExchanges)
      .where(eq(integrationExchanges.tenantId, DEMO_TENANT_ID));
    expect(rows.length).toBeGreaterThan(500);
  });

  it('most exchanges are completed', async () => {
    const rows = await db
      .select({ statusCode: integrationExchanges.statusCode })
      .from(integrationExchanges)
      .where(eq(integrationExchanges.tenantId, DEMO_TENANT_ID));
    const completed = rows.filter(r => r.statusCode === 'completed').length;
    // seq % 20 === 0 → 5% of seqs fail, across 2 components each → ~10% of exchanges fail
    expect(completed).toBeGreaterThan(rows.length * 0.85);
  });
});

// ─── Story markers ────────────────────────────────────────────────────────────

describe('S4 story-marker persons', () => {
  it('alice (seq 1) exists with enrolled status', async () => {
    const aliceId = personId(DEMO_TENANT_ID, 1);
    const rows = await db
      .select({ statusCode: persons.personStatusCode })
      .from(persons)
      .where(eq(persons.id, aliceId));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.statusCode).toBe('enrolled');
  });

  it('bob (seq 2) has an EC claim', async () => {
    const bobPersonId = personId(DEMO_TENANT_ID, 2);
    const rows = await db.execute(
      sql`SELECT id FROM wellbeing.ec_claim
          WHERE tenant_id = ${DEMO_TENANT_ID} AND person_id = ${bobPersonId}`,
    ) as Array<{ id: string }>;
    expect(rows).toHaveLength(1);
  });

  it('carol (seq 3) has a reasonable adjustment', async () => {
    const carolPersonId = personId(DEMO_TENANT_ID, 3);
    const rows = await db
      .select({ id: reasonableAdjustments.id })
      .from(reasonableAdjustments)
      .where(eq(reasonableAdjustments.personId, carolPersonId));
    expect(rows.length).toBeGreaterThanOrEqual(1);
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
  it('second load keeps mark count stable', async () => {
    const before = await db
      .select({ id: marks.id })
      .from(marks)
      .where(eq(marks.tenantId, DEMO_TENANT_ID));

    await resetScenario({
      databaseUrl:  container.getConnectionUri(),
      tenantId:     DEMO_TENANT_ID,
      scenarioSlug: 'assessment-marks',
    });

    const after = await db
      .select({ id: marks.id })
      .from(marks)
      .where(eq(marks.tenantId, DEMO_TENANT_ID));

    expect(after.length).toBe(before.length);
  });
});
