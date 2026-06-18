import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { eq, count, and, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, type Db } from '@revelation-srs/db';
import {
  awards,
  enrolments,
  examBoardCandidateProfiles,
  examBoardDataPacks,
  examBoardMemberAttendance,
  examBoards,
  externalExaminerSignoffs,
  hesaStudentReturns,
  marks,
  moduleRegistrations,
  moduleResults,
  persons,
  postRatificationAmendments,
  postRatificationCases,
  progressionDecisions,
} from '@revelation-srs/db';

import { resetScenario } from '../src/reset.js';
import { deterministicId } from '../src/generators/ids.js';

import { applyAllMigrations } from './helpers/migrations.js';

// ─── Test setup ───────────────────────────────────────────────────────────────

const DEMO_TENANT_ID = 'a6000000-0000-4000-8000-000000000001';

let container: StartedPostgreSqlContainer;
let db: Db;
let startMs: number;

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase('srs_s6_test')
    .start();

  db = createDb(container.getConnectionUri());
  await applyAllMigrations(db);

  await db.execute(sql`
    UPDATE deployment_environment SET active = false WHERE production_like = true
  `);

  await db.execute(sql`
    INSERT INTO tenant (id, code, name, active, demo_mode)
    VALUES (${DEMO_TENANT_ID}, 'S6DEMO', 'DEMO - S6 Full-Institution Year', true, true)
  `);

  process.env['DEMO_DATA_ENABLED']  = 'true';
  process.env['DEMO_RESET_ALLOWED'] = 'true';

  startMs = Date.now();
  await resetScenario({
    databaseUrl:  container.getConnectionUri(),
    tenantId:     DEMO_TENANT_ID,
    scenarioSlug: 'institution-year',
  });
}, 600_000);

afterAll(async () => {
  await container?.stop();
});

// Helper: enrolment ID for a sequence number
function enrolmentId(seq: number): string {
  return deterministicId('s6-enrolment', DEMO_TENANT_ID, String(seq));
}

// ─── Load time ────────────────────────────────────────────────────────────────

describe('Institution Year load time', () => {
  it('loads within the 30-minute budget', () => {
    const elapsed = Date.now() - startMs;
    expect(elapsed).toBeLessThan(1_800_000);
  });
});

// ─── Student counts ───────────────────────────────────────────────────────────

describe('Student counts', () => {
  it('loads exactly 50,000 persons', async () => {
    const [row] = await db
      .select({ n: count() })
      .from(persons)
      .where(eq(persons.tenantId, DEMO_TENANT_ID));
    expect(row!.n).toBe(50_000);
  });

  it('loads exactly 50,000 enrolments', async () => {
    const [row] = await db
      .select({ n: count() })
      .from(enrolments)
      .where(eq(enrolments.tenantId, DEMO_TENANT_ID));
    expect(row!.n).toBe(50_000);
  });

  it('has enrolled, graduated, withdrawn, and intermitting students', async () => {
    const rows = await db
      .selectDistinct({ code: enrolments.statusCode })
      .from(enrolments)
      .where(eq(enrolments.tenantId, DEMO_TENANT_ID));
    const codes = rows.map(r => r.code);
    expect(codes).toContain('enrolled');
    expect(codes).toContain('graduated');
    expect(codes).toContain('withdrawn');
    expect(codes).toContain('intermitting');
  });
});

// ─── Exam boards ─────────────────────────────────────────────────────────────

describe('Exam boards', () => {
  it('creates 16 exam boards (4 years × 4 boards each)', async () => {
    const [row] = await db
      .select({ n: count() })
      .from(examBoards)
      .where(eq(examBoards.tenantId, DEMO_TENANT_ID));
    expect(row!.n).toBe(16);
  });

  it('creates 12 data packs (3 per year: autumn + spring + award)', async () => {
    const [row] = await db
      .select({ n: count() })
      .from(examBoardDataPacks)
      .where(eq(examBoardDataPacks.tenantId, DEMO_TENANT_ID));
    expect(row!.n).toBe(12);
  });

  it('creates at least 12 external examiner sign-offs (3 per year)', async () => {
    const [row] = await db
      .select({ n: count() })
      .from(externalExaminerSignoffs)
      .where(eq(externalExaminerSignoffs.tenantId, DEMO_TENANT_ID));
    expect(row!.n).toBeGreaterThanOrEqual(12);
  });

  it('creates at least 36 member attendance records (3 boards × 3 attendees × 4 years)', async () => {
    const [row] = await db
      .select({ n: count() })
      .from(examBoardMemberAttendance)
      .where(eq(examBoardMemberAttendance.tenantId, DEMO_TENANT_ID));
    expect(row!.n).toBeGreaterThanOrEqual(36);
  });
});

// ─── Candidate profiles ───────────────────────────────────────────────────────

describe('Candidate profiles', () => {
  it('creates at least 5,000 candidate profiles', async () => {
    const [row] = await db
      .select({ n: count() })
      .from(examBoardCandidateProfiles)
      .where(eq(examBoardCandidateProfiles.tenantId, DEMO_TENANT_ID));
    expect(row!.n).toBeGreaterThanOrEqual(5_000);
  });
});

// ─── Assessment ───────────────────────────────────────────────────────────────

describe('Marks and results', () => {
  it('creates at least 50,000 marks', async () => {
    const [row] = await db
      .select({ n: count() })
      .from(marks)
      .where(eq(marks.tenantId, DEMO_TENANT_ID));
    expect(row!.n).toBeGreaterThanOrEqual(50_000);
  });

  it('all marks are locked', async () => {
    const [row] = await db
      .select({ n: count() })
      .from(marks)
      .where(and(eq(marks.tenantId, DEMO_TENANT_ID), eq(marks.locked, false)));
    expect(row!.n).toBe(0);
  });

  it('creates at least 25,000 module results', async () => {
    const [row] = await db
      .select({ n: count() })
      .from(moduleResults)
      .where(eq(moduleResults.tenantId, DEMO_TENANT_ID));
    expect(row!.n).toBeGreaterThanOrEqual(25_000);
  });
});

// ─── Module registrations ─────────────────────────────────────────────────────

describe('Module registrations', () => {
  it('creates at least 50,000 module registrations', async () => {
    const [row] = await db
      .select({ n: count() })
      .from(moduleRegistrations)
      .where(eq(moduleRegistrations.tenantId, DEMO_TENANT_ID));
    expect(row!.n).toBeGreaterThanOrEqual(50_000);
  });
});

// ─── Progression and awards ───────────────────────────────────────────────────

describe('Progression decisions', () => {
  it('creates at least 20,000 progression decisions', async () => {
    const [row] = await db
      .select({ n: count() })
      .from(progressionDecisions)
      .where(eq(progressionDecisions.tenantId, DEMO_TENANT_ID));
    expect(row!.n).toBeGreaterThanOrEqual(20_000);
  });

  it('all progression decisions are locked', async () => {
    const [row] = await db
      .select({ n: count() })
      .from(progressionDecisions)
      .where(and(
        eq(progressionDecisions.tenantId, DEMO_TENANT_ID),
        eq(progressionDecisions.locked, false),
      ));
    expect(row!.n).toBe(0);
  });

  it('eva (seq 5) has a resit progression decision', async () => {
    const rows = await db
      .select({ code: progressionDecisions.decisionCode })
      .from(progressionDecisions)
      .where(and(
        eq(progressionDecisions.tenantId, DEMO_TENANT_ID),
        eq(progressionDecisions.enrolmentId, enrolmentId(5)),
      ));
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows[0]!.code).toBe('resit');
  });
});

describe('Awards', () => {
  it('creates at least 5,000 awards (2022-23 cohort graduates)', async () => {
    const [row] = await db
      .select({ n: count() })
      .from(awards)
      .where(eq(awards.tenantId, DEMO_TENANT_ID));
    expect(row!.n).toBeGreaterThanOrEqual(5_000);
  });

  it('fin (seq 6) has a first-class award', async () => {
    const rows = await db
      .select({ classCode: awards.classificationCode })
      .from(awards)
      .where(and(
        eq(awards.tenantId, DEMO_TENANT_ID),
        eq(awards.enrolmentId, enrolmentId(6)),
      ));
    expect(rows.length).toBe(1);
    expect(rows[0]!.classCode).toBe('first');
  });
});

// ─── HESA regulatory history ──────────────────────────────────────────────────

describe('HESA regulatory history', () => {
  it('creates exactly 4 HESA student return rows (3 submitted + 1 draft)', async () => {
    const [row] = await db
      .select({ n: count() })
      .from(hesaStudentReturns)
      .where(eq(hesaStudentReturns.tenantId, DEMO_TENANT_ID));
    expect(row!.n).toBe(4);
  });

  it('3 returns are submitted and 1 is in draft', async () => {
    const rows = await db
      .selectDistinct({ status: hesaStudentReturns.statusCode })
      .from(hesaStudentReturns)
      .where(eq(hesaStudentReturns.tenantId, DEMO_TENANT_ID));
    const statuses = rows.map(r => r.status);
    expect(statuses).toContain('submitted');
    expect(statuses).toContain('draft');
  });

  it('2025-26 return is in draft', async () => {
    const rows = await db
      .select({ status: hesaStudentReturns.statusCode })
      .from(hesaStudentReturns)
      .where(and(
        eq(hesaStudentReturns.tenantId, DEMO_TENANT_ID),
        eq(hesaStudentReturns.academicYear, '2025-26'),
      ));
    expect(rows.length).toBe(1);
    expect(rows[0]!.status).toBe('draft');
  });

  it('submitted returns carry DEMO-HESA reference numbers', async () => {
    const rows = await db
      .select({ ref: hesaStudentReturns.submissionReference })
      .from(hesaStudentReturns)
      .where(eq(hesaStudentReturns.tenantId, DEMO_TENANT_ID));
    const submitted = rows.filter(r => r.ref !== null);
    expect(submitted.length).toBe(3);
    for (const r of submitted) {
      expect(r.ref).toMatch(/^DEMO-HESA-/);
    }
  });
});

// ─── Story markers ────────────────────────────────────────────────────────────

describe('S6 story-marker persons', () => {
  it('alex (seq 1) is enrolled with entry year 2025-26', async () => {
    const rows = await db
      .select({ status: enrolments.statusCode, entryYear: enrolments.academicYearOfEntry })
      .from(enrolments)
      .where(and(
        eq(enrolments.tenantId, DEMO_TENANT_ID),
        eq(enrolments.id, enrolmentId(1)),
      ));
    expect(rows.length).toBe(1);
    expect(rows[0]!.status).toBe('enrolled');
    expect(rows[0]!.entryYear).toBe('2025-26');
  });

  it('ben (seq 2) is enrolled with entry year 2022-23 (intercalated arc)', async () => {
    const rows = await db
      .select({ status: enrolments.statusCode, entryYear: enrolments.academicYearOfEntry })
      .from(enrolments)
      .where(and(
        eq(enrolments.tenantId, DEMO_TENANT_ID),
        eq(enrolments.id, enrolmentId(2)),
      ));
    expect(rows.length).toBe(1);
    expect(rows[0]!.status).toBe('enrolled');
    expect(rows[0]!.entryYear).toBe('2022-23');
  });

  it('cara (seq 3) is enrolled as an international student', async () => {
    const rows = await db
      .select({ funding: enrolments.fundingSourceCode, feeBand: enrolments.feeBandCode })
      .from(enrolments)
      .where(and(
        eq(enrolments.tenantId, DEMO_TENANT_ID),
        eq(enrolments.id, enrolmentId(3)),
      ));
    expect(rows.length).toBe(1);
    expect(rows[0]!.funding).toBe('self-funded');
    expect(rows[0]!.feeBand).toBe('overseas');
  });

  it('dan (seq 4) is enrolled with entry year 2024-25 (wellbeing arc)', async () => {
    const rows = await db
      .select({ status: enrolments.statusCode, entryYear: enrolments.academicYearOfEntry })
      .from(enrolments)
      .where(and(
        eq(enrolments.tenantId, DEMO_TENANT_ID),
        eq(enrolments.id, enrolmentId(4)),
      ));
    expect(rows.length).toBe(1);
    expect(rows[0]!.status).toBe('enrolled');
    expect(rows[0]!.entryYear).toBe('2024-25');
  });

  it('fin (seq 6) is graduated with entry year 2022-23', async () => {
    const rows = await db
      .select({ status: enrolments.statusCode, entryYear: enrolments.academicYearOfEntry })
      .from(enrolments)
      .where(and(
        eq(enrolments.tenantId, DEMO_TENANT_ID),
        eq(enrolments.id, enrolmentId(6)),
      ));
    expect(rows.length).toBe(1);
    expect(rows[0]!.status).toBe('graduated');
    expect(rows[0]!.entryYear).toBe('2022-23');
  });
});

// ─── Post-ratification corrections ───────────────────────────────────────────

describe('Post-ratification cases', () => {
  it('creates exactly 3 post-ratification cases', async () => {
    const [row] = await db
      .select({ n: count() })
      .from(postRatificationCases)
      .where(eq(postRatificationCases.tenantId, DEMO_TENANT_ID));
    expect(row!.n).toBe(3);
  });

  it('case statuses cover upheld, under-review, dismissed', async () => {
    const rows = await db
      .selectDistinct({ s: postRatificationCases.statusCode })
      .from(postRatificationCases)
      .where(eq(postRatificationCases.tenantId, DEMO_TENANT_ID));
    const statuses = rows.map(r => r.s);
    expect(statuses).toContain('upheld');
    expect(statuses).toContain('under-review');
    expect(statuses).toContain('dismissed');
  });

  it('creates exactly 1 post-ratification amendment', async () => {
    const [row] = await db
      .select({ n: count() })
      .from(postRatificationAmendments)
      .where(eq(postRatificationAmendments.tenantId, DEMO_TENANT_ID));
    expect(row!.n).toBe(1);
  });
});

// ─── Idempotency ─────────────────────────────────────────────────────────────

describe('Idempotency', () => {
  it('second load does not increase award count', async () => {
    const [before] = await db
      .select({ n: count() })
      .from(awards)
      .where(eq(awards.tenantId, DEMO_TENANT_ID));

    await resetScenario({
      databaseUrl:  container.getConnectionUri(),
      tenantId:     DEMO_TENANT_ID,
      scenarioSlug: 'institution-year',
    });

    const [after] = await db
      .select({ n: count() })
      .from(awards)
      .where(eq(awards.tenantId, DEMO_TENANT_ID));
    expect(after!.n).toBe(before!.n);
  });

  it('second load does not increase enrolment count', async () => {
    const [row] = await db
      .select({ n: count() })
      .from(enrolments)
      .where(eq(enrolments.tenantId, DEMO_TENANT_ID));
    expect(row!.n).toBe(50_000);
  });
});
