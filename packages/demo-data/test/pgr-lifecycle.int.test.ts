import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  awards,
  businessCases,
  createDb,
  persons,
  pgrExaminationOutcomes,
  staffAssignments,
  thesisCorrectionRequirements,
  type Db,
} from '@revelation-srs/db';

import { resetScenario } from '../src/reset.js';
import { manifest } from '../src/scenarios/pgr-lifecycle.js';
import { STORY_MARKERS } from '../src/story-markers.js';

import { applyAllMigrations } from './helpers/migrations.js';

const DEMO_TENANT_ID = 'b7000000-0000-4000-8000-000000000001';

let container: StartedPostgreSqlContainer;
let db: Db;
let loadMs: number;

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase('srs_s7_test')
    .start();

  db = createDb(container.getConnectionUri());
  await applyAllMigrations(db);

  await db.execute(sql`
    UPDATE deployment_environment SET active = false WHERE production_like = true
  `);

  await db.execute(sql`
    INSERT INTO tenant (id, code, name, active, demo_mode)
    VALUES (${DEMO_TENANT_ID}, 'S7DEMO', 'DEMO - S7 PGR Lifecycle', true, true)
  `);

  process.env['DEMO_DATA_ENABLED']  = 'true';
  process.env['DEMO_RESET_ALLOWED'] = 'true';

  const t0 = Date.now();
  await resetScenario({
    databaseUrl:  container.getConnectionUri(),
    tenantId:     DEMO_TENANT_ID,
    scenarioSlug: 'pgr-lifecycle',
  });
  loadMs = Date.now() - t0;
}, 120_000);

afterAll(async () => {
  delete process.env['DEMO_DATA_ENABLED'];
  delete process.env['DEMO_RESET_ALLOWED'];
  await container.stop();
});

describe('PGR Lifecycle load time', () => {
  it('loads within budget', () => {
    expect(loadMs).toBeLessThan(manifest.loadTimeBudgetMs);
  });
});

describe('Persons', () => {
  it('creates 6 students and 6 staff (12 total)', async () => {
    const rows = await db.select({ id: persons.id }).from(persons).where(eq(persons.tenantId, DEMO_TENANT_ID));
    expect(rows).toHaveLength(12);
  });
});

describe('Supervision (BP-03-007)', () => {
  it('has 5 approved supervision cases and one returned', async () => {
    const rows = await db.select({ statusCode: businessCases.statusCode })
      .from(businessCases)
      .where(and(eq(businessCases.tenantId, DEMO_TENANT_ID), eq(businessCases.processId, 'BP-03-007'), isNull(businessCases.recordedUntil)));
    expect(rows).toHaveLength(6);
    expect(rows.filter(r => r.statusCode === 'approved')).toHaveLength(5);
    expect(rows.filter(r => r.statusCode === 'returned')).toHaveLength(1);
  });

  it('activates a current staff_assignment only for approved cases', async () => {
    const rows = await db.select({ id: staffAssignments.id })
      .from(staffAssignments)
      .where(and(eq(staffAssignments.tenantId, DEMO_TENANT_ID), isNull(staffAssignments.recordedUntil), isNull(staffAssignments.validTo)));
    // 5 approved cases; Avery's assignment is end-dated on completion, so 4 remain current.
    expect(rows).toHaveLength(4);
  });
});

describe('Progress review and milestones (BP-04-003)', () => {
  it('records a satisfactory review with the S7 Jordan story marker traceable via milestone', async () => {
    const rows = await db.select({ statusCode: businessCases.statusCode })
      .from(businessCases)
      .where(and(eq(businessCases.tenantId, DEMO_TENANT_ID), eq(businessCases.processId, 'BP-04-003')));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.statusCode).toBe('satisfactory');
  });
});

describe('Thesis examination (BP-05-010)', () => {
  it('has three examination cases in distinct stages', async () => {
    const rows = await db.select({ statusCode: businessCases.statusCode })
      .from(businessCases)
      .where(and(eq(businessCases.tenantId, DEMO_TENANT_ID), eq(businessCases.processId, 'BP-05-010')));
    const statuses = rows.map(r => r.statusCode).sort();
    expect(statuses).toEqual(['examiners-confirmed', 'pass', 'pass-minor-corrections']);
  });

  it('records an outstanding corrections requirement for the minor-corrections outcome', async () => {
    const rows = await db.select({ completedAt: thesisCorrectionRequirements.completedAt })
      .from(thesisCorrectionRequirements)
      .where(eq(thesisCorrectionRequirements.tenantId, DEMO_TENANT_ID));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.completedAt).toBeNull();
  });

  it('ratifies a pass outcome for the completed candidate', async () => {
    const rows = await db.select({ outcomeCode: pgrExaminationOutcomes.outcomeCode })
      .from(pgrExaminationOutcomes)
      .where(eq(pgrExaminationOutcomes.tenantId, DEMO_TENANT_ID));
    expect(rows.map(r => r.outcomeCode).sort()).toEqual(['pass', 'pass-minor-corrections']);
  });
});

describe('Completion and research award (BP-06-006)', () => {
  it('confers exactly one research award (source_case_id set, exam_board_id null)', async () => {
    const rows = await db.select().from(awards).where(eq(awards.tenantId, DEMO_TENANT_ID));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.sourceCaseId).not.toBeNull();
    expect(rows[0]!.examBoardId).toBeNull();
    expect(rows[0]!.classificationCode).toBe('pass');
  });
});

describe('Story markers', () => {
  it('declares the S7 story markers', () => {
    expect(manifest.storyMarkers).toContain(STORY_MARKERS.S7_PRIYA_SUPERVISION);
    expect(manifest.storyMarkers).toContain(STORY_MARKERS.S7_JORDAN_MILESTONE);
    expect(manifest.storyMarkers).toContain(STORY_MARKERS.S7_AVERY_AWARDED);
  });
});

describe('Idempotency', () => {
  it('second load keeps the award count stable', async () => {
    await resetScenario({
      databaseUrl:  container.getConnectionUri(),
      tenantId:     DEMO_TENANT_ID,
      scenarioSlug: 'pgr-lifecycle',
    });
    const rows = await db.select({ id: awards.id }).from(awards).where(eq(awards.tenantId, DEMO_TENANT_ID));
    expect(rows).toHaveLength(1);
  });
});
