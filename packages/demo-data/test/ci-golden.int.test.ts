import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createDb,
  enrolments,
  examBoards,
  persons,
  workflowInstances,
  workflowTasks,
  type Db,
} from '@revelation-srs/db';

import { GOLDEN_IDS } from '../src/golden-ids.js';
import { resetScenario } from '../src/reset.js';
import { manifest } from '../src/scenarios/ci-golden.js';

import { applyAllMigrations } from './helpers/migrations.js';

const DEMO_TENANT_ID = 'dd000000-0000-4000-8000-000000000001';

let container: StartedPostgreSqlContainer;
let db: Db;
let loadMs: number;

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase('srs_golden_test')
    .start();

  db = createDb(container.getConnectionUri());
  await applyAllMigrations(db);

  // Deactivate seeded production-like environments so Gate 5 passes.
  await db.execute(sql`
    UPDATE deployment_environment SET active = false
    WHERE production_like = true
  `);

  // Create the demo tenant.
  await db.execute(sql`
    INSERT INTO tenant (id, code, name, active, demo_mode)
    VALUES (${DEMO_TENANT_ID}, 'DEMO', 'DEMO - Demo University', true, true)
  `);

  // Set env vars required by the safety gates.
  process.env['DEMO_DATA_ENABLED']  = 'true';
  process.env['DEMO_RESET_ALLOWED'] = 'true';

  // Load the scenario and measure elapsed time.
  const t0 = Date.now();
  await resetScenario({
    databaseUrl:  container.getConnectionUri(),
    tenantId:     DEMO_TENANT_ID,
    scenarioSlug: 'ci-golden',
  });
  loadMs = Date.now() - t0;
}, 120_000);

afterAll(async () => {
  delete process.env['DEMO_DATA_ENABLED'];
  delete process.env['DEMO_RESET_ALLOWED'];
  await container.stop();
});

// ─── Load time ────────────────────────────────────────────────────────────────

describe('CI Golden Dataset load time', () => {
  it('loads in under 10 seconds', () => {
    expect(loadMs).toBeLessThan(manifest.loadTimeBudgetMs);
  });
});

// ─── Persons ─────────────────────────────────────────────────────────────────

describe('Persons', () => {
  it('has all four golden persons', async () => {
    const rows = await db
      .select({ id: persons.id, studentNumber: persons.studentNumber })
      .from(persons)
      .where(eq(persons.tenantId, DEMO_TENANT_ID));

    const ids = rows.map(r => r.id);
    expect(ids).toContain(GOLDEN_IDS.PERSON_ENROLLED);
    expect(ids).toContain(GOLDEN_IDS.PERSON_INTERMITTING);
    expect(ids).toContain(GOLDEN_IDS.PERSON_WITHDRAWN);
    expect(ids).toContain(GOLDEN_IDS.PERSON_GRADUATED);
  });

  it('person student numbers are stable', async () => {
    const row = await db
      .select({ studentNumber: persons.studentNumber })
      .from(persons)
      .where(eq(persons.id, GOLDEN_IDS.PERSON_ENROLLED))
      .limit(1);
    expect(row[0]?.studentNumber).toBe('S24000001');
  });
});

// ─── Enrolments ──────────────────────────────────────────────────────────────

describe('Enrolments', () => {
  const cases: [string, string][] = [
    [GOLDEN_IDS.ENROLMENT_ENROLLED,     'enrolled'],
    [GOLDEN_IDS.ENROLMENT_INTERMITTING, 'intermitting'],
    [GOLDEN_IDS.ENROLMENT_WITHDRAWN,    'withdrawn'],
    [GOLDEN_IDS.ENROLMENT_GRADUATED,    'graduated'],
  ];

  it.each(cases)('enrolment %s has statusCode "%s"', async (enrolmentId, expectedStatus) => {
    const rows = await db
      .select({ statusCode: enrolments.statusCode })
      .from(enrolments)
      .where(eq(enrolments.id, enrolmentId));

    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows[0]?.statusCode).toBe(expectedStatus);
  });
});

// ─── Exam boards ─────────────────────────────────────────────────────────────

describe('Exam boards', () => {
  it('BOARD_SCHEDULED has no ratifiedAt and no quorum', async () => {
    const rows = await db
      .select({ ratifiedAt: examBoards.ratifiedAt, quorumCount: examBoards.quorumCount })
      .from(examBoards)
      .where(eq(examBoards.id, GOLDEN_IDS.BOARD_SCHEDULED));

    expect(rows[0]?.ratifiedAt).toBeNull();
    expect(rows[0]?.quorumCount).toBeNull();
  });

  it('BOARD_OPEN has quorum but no ratifiedAt', async () => {
    const rows = await db
      .select({ ratifiedAt: examBoards.ratifiedAt, quorumCount: examBoards.quorumCount })
      .from(examBoards)
      .where(eq(examBoards.id, GOLDEN_IDS.BOARD_OPEN));

    expect(rows[0]?.ratifiedAt).toBeNull();
    expect(rows[0]?.quorumCount).toBe(5);
  });

  it('BOARD_RATIFIED has ratifiedAt set', async () => {
    const rows = await db
      .select({ ratifiedAt: examBoards.ratifiedAt })
      .from(examBoards)
      .where(eq(examBoards.id, GOLDEN_IDS.BOARD_RATIFIED));

    expect(rows[0]?.ratifiedAt).not.toBeNull();
  });
});

// ─── Workflow ─────────────────────────────────────────────────────────────────

describe('Workflow instances', () => {
  const cases: [string, string][] = [
    [GOLDEN_IDS.WORKFLOW_INSTANCE_PENDING,   'pending'],
    [GOLDEN_IDS.WORKFLOW_INSTANCE_ACTIVE,    'in-progress'],
    [GOLDEN_IDS.WORKFLOW_INSTANCE_COMPLETED, 'completed'],
  ];

  it.each(cases)('instance %s has statusCode "%s"', async (instanceId, expectedStatus) => {
    const rows = await db
      .select({ statusCode: workflowInstances.statusCode })
      .from(workflowInstances)
      .where(eq(workflowInstances.id, instanceId));

    expect(rows[0]?.statusCode).toBe(expectedStatus);
  });
});

describe('Workflow tasks', () => {
  const cases: [string, string][] = [
    [GOLDEN_IDS.WORKFLOW_TASK_PENDING, 'pending'],
    [GOLDEN_IDS.WORKFLOW_TASK_CLAIMED, 'in-progress'],
    [GOLDEN_IDS.WORKFLOW_TASK_DONE,    'completed'],
  ];

  it.each(cases)('task %s has statusCode "%s"', async (taskId, expectedStatus) => {
    const rows = await db
      .select({ statusCode: workflowTasks.statusCode })
      .from(workflowTasks)
      .where(eq(workflowTasks.id, taskId));

    expect(rows[0]?.statusCode).toBe(expectedStatus);
  });
});

// ─── Idempotency ──────────────────────────────────────────────────────────────

describe('Idempotency', () => {
  it('loading the scenario twice does not produce errors', async () => {
    await expect(
      resetScenario({
        databaseUrl:  container.getConnectionUri(),
        tenantId:     DEMO_TENANT_ID,
        scenarioSlug: 'ci-golden',
      }),
    ).resolves.toBeUndefined();
  });

  it('person count remains stable after second load', async () => {
    const rows = await db
      .select({ id: persons.id })
      .from(persons)
      .where(eq(persons.tenantId, DEMO_TENANT_ID));
    expect(rows.length).toBe(4);
  });
});
