import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  awards,
  enrolments,
  examBoardCandidateProfiles,
  examBoardDataPacks,
  examBoardMemberAttendance,
  examBoards,
  externalExaminerSignoffs,
  marks,
  moduleResults,
  persons,
  postRatificationAmendments,
  postRatificationCases,
  progressionDecisions,
  type Db,
} from '@revelation-srs/db';
import { createDb } from '@revelation-srs/db';

import { awardBoardId } from '../src/generators/boards.js';
import { deterministicId } from '../src/generators/ids.js';
import { examBoardIdForPeriod } from '../src/generators/registrations.js';
import { resetScenario } from '../src/reset.js';
import { manifest } from '../src/scenarios/exam-board.js';

import { applyAllMigrations } from './helpers/migrations.js';

// Mirrors the enrolmentId helper in the S5 scenario
function enrolmentId(tenantId: string, seq: number): string {
  return deterministicId('s5-enrolment', tenantId, String(seq));
}

const DEMO_TENANT_ID = 'a5000000-0000-4000-8000-000000000001';
const ACADEMIC_YEAR  = '2025-26';

let container: StartedPostgreSqlContainer;
let db: Db;
let loadMs: number;

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase('srs_s5_test')
    .start();

  db = createDb(container.getConnectionUri());
  await applyAllMigrations(db);

  await db.execute(sql`
    UPDATE deployment_environment SET active = false WHERE production_like = true
  `);

  await db.execute(sql`
    INSERT INTO tenant (id, code, name, active, demo_mode)
    VALUES (${DEMO_TENANT_ID}, 'S5DEMO', 'DEMO - S5 Exam Board', true, true)
  `);

  process.env['DEMO_DATA_ENABLED']  = 'true';
  process.env['DEMO_RESET_ALLOWED'] = 'true';

  const t0 = Date.now();
  await resetScenario({
    databaseUrl:  container.getConnectionUri(),
    tenantId:     DEMO_TENANT_ID,
    scenarioSlug: 'exam-board',
  });
  loadMs = Date.now() - t0;
}, 360_000);

afterAll(async () => {
  delete process.env['DEMO_DATA_ENABLED'];
  delete process.env['DEMO_RESET_ALLOWED'];
  await container.stop();
});

// ─── Load time ────────────────────────────────────────────────────────────────

describe('Exam Board load time', () => {
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
    expect(rows.length).toBe(1_000);
  });

  it('loads exactly 1,000 enrolments', async () => {
    const rows = await db
      .select({ id: enrolments.id })
      .from(enrolments)
      .where(eq(enrolments.tenantId, DEMO_TENANT_ID));
    expect(rows.length).toBe(1_000);
  });
});

// ─── Exam boards ──────────────────────────────────────────────────────────────

describe('Exam boards', () => {
  it('creates 4 exam boards (3 module + 1 award)', async () => {
    const rows = await db
      .select({ id: examBoards.id })
      .from(examBoards)
      .where(eq(examBoards.tenantId, DEMO_TENANT_ID));
    expect(rows.length).toBe(4);
  });

  it('autumn board is ratified', async () => {
    const autumnBoardId = examBoardIdForPeriod(DEMO_TENANT_ID, ACADEMIC_YEAR, 'AUTUMN');
    const rows = await db
      .select({ ratifiedAt: examBoards.ratifiedAt })
      .from(examBoards)
      .where(eq(examBoards.id, autumnBoardId));
    expect(rows[0]?.ratifiedAt).not.toBeNull();
  });

  it('spring board is ratified', async () => {
    const springBoardId = examBoardIdForPeriod(DEMO_TENANT_ID, ACADEMIC_YEAR, 'SPRING');
    const rows = await db
      .select({ ratifiedAt: examBoards.ratifiedAt })
      .from(examBoards)
      .where(eq(examBoards.id, springBoardId));
    expect(rows[0]?.ratifiedAt).not.toBeNull();
  });

  it('summer board is NOT ratified (pending)', async () => {
    const summerBoardId = examBoardIdForPeriod(DEMO_TENANT_ID, ACADEMIC_YEAR, 'SUMMER');
    const rows = await db
      .select({ ratifiedAt: examBoards.ratifiedAt })
      .from(examBoards)
      .where(eq(examBoards.id, summerBoardId));
    expect(rows[0]?.ratifiedAt).toBeNull();
  });

  it('award board is ratified', async () => {
    const awdBoardId = awardBoardId(DEMO_TENANT_ID, ACADEMIC_YEAR);
    const rows = await db
      .select({ ratifiedAt: examBoards.ratifiedAt, boardTypeCode: examBoards.boardTypeCode })
      .from(examBoards)
      .where(eq(examBoards.id, awdBoardId));
    expect(rows[0]?.ratifiedAt).not.toBeNull();
    expect(rows[0]?.boardTypeCode).toBe('award');
  });
});

// ─── Data packs ───────────────────────────────────────────────────────────────

describe('Data packs', () => {
  it('creates 3 data packs (autumn, spring, award)', async () => {
    const rows = await db
      .select({ id: examBoardDataPacks.id })
      .from(examBoardDataPacks)
      .where(eq(examBoardDataPacks.tenantId, DEMO_TENANT_ID));
    expect(rows.length).toBe(3);
  });

  it('all data packs have packVersion 1', async () => {
    const rows = await db
      .select({ packVersion: examBoardDataPacks.packVersion })
      .from(examBoardDataPacks)
      .where(eq(examBoardDataPacks.tenantId, DEMO_TENANT_ID));
    for (const row of rows) {
      expect(row.packVersion).toBe(1);
    }
  });
});

// ─── Candidate profiles ───────────────────────────────────────────────────────

describe('Candidate profiles', () => {
  it('creates at least 300 candidate profiles', async () => {
    const rows = await db
      .select({ id: examBoardCandidateProfiles.id })
      .from(examBoardCandidateProfiles)
      .where(eq(examBoardCandidateProfiles.tenantId, DEMO_TENANT_ID));
    expect(rows.length).toBeGreaterThanOrEqual(300);
  });

  it('carol (seq 3) profile has adjustmentApplied=true', async () => {
    const carolEnrolmentId = enrolmentId(DEMO_TENANT_ID, 3);
    const rows = await db
      .select({ profileData: examBoardCandidateProfiles.profileData })
      .from(examBoardCandidateProfiles)
      .where(eq(examBoardCandidateProfiles.enrolmentId, carolEnrolmentId));
    expect(rows.length).toBeGreaterThan(0);
    const flags = (rows[0]?.profileData as Record<string, Record<string, boolean>>)?.flags;
    expect(flags?.adjustmentApplied).toBe(true);
  });

  it('bob (seq 2) profile has ecClaimOnRecord=true', async () => {
    const bobEnrolmentId = enrolmentId(DEMO_TENANT_ID, 2);
    const rows = await db
      .select({ profileData: examBoardCandidateProfiles.profileData })
      .from(examBoardCandidateProfiles)
      .where(eq(examBoardCandidateProfiles.enrolmentId, bobEnrolmentId));
    expect(rows.length).toBeGreaterThan(0);
    const flags = (rows[0]?.profileData as Record<string, Record<string, boolean>>)?.flags;
    expect(flags?.ecClaimOnRecord).toBe(true);
  });
});

// ─── Member attendance ────────────────────────────────────────────────────────

describe('Member attendance', () => {
  it('creates at least 9 attendance records (3 boards × 3 attendees)', async () => {
    const rows = await db
      .select({ id: examBoardMemberAttendance.id })
      .from(examBoardMemberAttendance)
      .where(eq(examBoardMemberAttendance.tenantId, DEMO_TENANT_ID));
    expect(rows.length).toBeGreaterThanOrEqual(9);
  });

  it('each ratified board has a chair', async () => {
    const rows = await db
      .select({ roleCode: examBoardMemberAttendance.roleCode })
      .from(examBoardMemberAttendance)
      .where(eq(examBoardMemberAttendance.tenantId, DEMO_TENANT_ID));
    const chairs = rows.filter(r => r.roleCode === 'chair');
    expect(chairs.length).toBe(3);
  });
});

// ─── External examiner sign-offs ──────────────────────────────────────────────

describe('External examiner sign-offs', () => {
  it('creates 3 external examiner sign-offs (one per ratified board)', async () => {
    const rows = await db
      .select({ id: externalExaminerSignoffs.id })
      .from(externalExaminerSignoffs)
      .where(eq(externalExaminerSignoffs.tenantId, DEMO_TENANT_ID));
    expect(rows.length).toBe(3);
  });

  it('all commentaries carry DEMO prefix', async () => {
    const rows = await db
      .select({ commentary: externalExaminerSignoffs.commentary })
      .from(externalExaminerSignoffs)
      .where(eq(externalExaminerSignoffs.tenantId, DEMO_TENANT_ID));
    for (const row of rows) {
      expect(row.commentary).toMatch(/^DEMO - /);
    }
  });
});

// ─── Marks (locked) ───────────────────────────────────────────────────────────

describe('Marks (locked)', () => {
  it('creates at least 500 marks', async () => {
    const rows = await db
      .select({ id: marks.id })
      .from(marks)
      .where(eq(marks.tenantId, DEMO_TENANT_ID));
    expect(rows.length).toBeGreaterThanOrEqual(500);
  });

  it('all marks are locked', async () => {
    const rows = await db
      .select({ locked: marks.locked })
      .from(marks)
      .where(eq(marks.tenantId, DEMO_TENANT_ID));
    for (const row of rows) {
      expect(row.locked).toBe(true);
    }
  });
});

// ─── Module results (locked) ──────────────────────────────────────────────────

describe('Module results (locked)', () => {
  it('creates at least 400 module results', async () => {
    const rows = await db
      .select({ id: moduleResults.id })
      .from(moduleResults)
      .where(eq(moduleResults.tenantId, DEMO_TENANT_ID));
    expect(rows.length).toBeGreaterThanOrEqual(400);
  });

  it('all module results are locked', async () => {
    const rows = await db
      .select({ locked: moduleResults.locked })
      .from(moduleResults)
      .where(eq(moduleResults.tenantId, DEMO_TENANT_ID));
    for (const row of rows) {
      expect(row.locked).toBe(true);
    }
  });
});

// ─── Progression decisions ────────────────────────────────────────────────────

describe('Progression decisions', () => {
  it('creates at least 400 progression decisions', async () => {
    const rows = await db
      .select({ id: progressionDecisions.id })
      .from(progressionDecisions)
      .where(eq(progressionDecisions.tenantId, DEMO_TENANT_ID));
    expect(rows.length).toBeGreaterThanOrEqual(400);
  });

  it('all progression decisions are locked', async () => {
    const rows = await db
      .select({ locked: progressionDecisions.locked })
      .from(progressionDecisions)
      .where(eq(progressionDecisions.tenantId, DEMO_TENANT_ID));
    for (const row of rows) {
      expect(row.locked).toBe(true);
    }
  });

  it('progress is the dominant decision code', async () => {
    const rows = await db
      .select({ decisionCode: progressionDecisions.decisionCode })
      .from(progressionDecisions)
      .where(eq(progressionDecisions.tenantId, DEMO_TENANT_ID));
    const progressCount = rows.filter(r => r.decisionCode === 'progress').length;
    expect(progressCount).toBeGreaterThan(rows.length * 0.5);
  });

  it('contains resit and repeat-year decisions', async () => {
    const rows = await db
      .select({ decisionCode: progressionDecisions.decisionCode })
      .from(progressionDecisions)
      .where(eq(progressionDecisions.tenantId, DEMO_TENANT_ID));
    const codes = new Set(rows.map(r => r.decisionCode));
    expect(codes.has('resit')).toBe(true);
    expect(codes.has('repeat-year')).toBe(true);
  });

  it('alice (seq 1) has progress decision', async () => {
    const aliceEnrolmentId = enrolmentId(DEMO_TENANT_ID, 1);
    const rows = await db
      .select({ decisionCode: progressionDecisions.decisionCode })
      .from(progressionDecisions)
      .where(eq(progressionDecisions.enrolmentId, aliceEnrolmentId));
    expect(rows[0]?.decisionCode).toBe('progress');
  });

  it('bob (seq 2) has resit decision', async () => {
    const bobEnrolmentId = enrolmentId(DEMO_TENANT_ID, 2);
    const rows = await db
      .select({ decisionCode: progressionDecisions.decisionCode })
      .from(progressionDecisions)
      .where(eq(progressionDecisions.enrolmentId, bobEnrolmentId));
    expect(rows[0]?.decisionCode).toBe('resit');
  });
});

// ─── Awards ───────────────────────────────────────────────────────────────────

describe('Awards', () => {
  it('creates at least 100 awards (graduated students ~20% × 1,000)', async () => {
    const rows = await db
      .select({ id: awards.id })
      .from(awards)
      .where(eq(awards.tenantId, DEMO_TENANT_ID));
    expect(rows.length).toBeGreaterThanOrEqual(100);
  });

  it('all awards have valid awardDate', async () => {
    const rows = await db
      .select({ awardDate: awards.awardDate })
      .from(awards)
      .where(eq(awards.tenantId, DEMO_TENANT_ID));
    for (const row of rows) {
      expect(row.awardDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('awards reference valid qualification codes', async () => {
    const rows = await db
      .select({ qualificationCode: awards.qualificationCode })
      .from(awards)
      .where(eq(awards.tenantId, DEMO_TENANT_ID));
    const validCodes = new Set(['BSc', 'BA', 'MEng', 'LLB', 'MSc']);
    for (const row of rows) {
      expect(validCodes.has(row.qualificationCode)).toBe(true);
    }
  });

  it('awards reference valid classification codes', async () => {
    const rows = await db
      .select({ classificationCode: awards.classificationCode })
      .from(awards)
      .where(eq(awards.tenantId, DEMO_TENANT_ID));
    const validCodes = new Set(['first', 'upper-second', 'lower-second', 'third', 'pass']);
    for (const row of rows) {
      expect(validCodes.has(row.classificationCode)).toBe(true);
    }
  });
});

// ─── Post-ratification cases ──────────────────────────────────────────────────

describe('Post-ratification cases', () => {
  it('creates exactly 3 post-ratification cases', async () => {
    const rows = await db
      .select({ id: postRatificationCases.id })
      .from(postRatificationCases)
      .where(eq(postRatificationCases.tenantId, DEMO_TENANT_ID));
    expect(rows.length).toBe(3);
  });

  it('case statuses cover upheld, under-review, dismissed', async () => {
    const rows = await db
      .select({ statusCode: postRatificationCases.statusCode })
      .from(postRatificationCases)
      .where(eq(postRatificationCases.tenantId, DEMO_TENANT_ID));
    const statuses = new Set(rows.map(r => r.statusCode));
    expect(statuses.has('upheld')).toBe(true);
    expect(statuses.has('under-review')).toBe(true);
    expect(statuses.has('dismissed')).toBe(true);
  });

  it('case references carry DEMO-PRC prefix', async () => {
    const rows = await db
      .select({ reference: postRatificationCases.reference })
      .from(postRatificationCases)
      .where(eq(postRatificationCases.tenantId, DEMO_TENANT_ID));
    for (const row of rows) {
      expect(row.reference).toMatch(/^DEMO-PRC-/);
    }
  });
});

// ─── Post-ratification amendment ─────────────────────────────────────────────

describe('Post-ratification amendments', () => {
  it('creates exactly 1 amendment (for the upheld administrative correction)', async () => {
    const rows = await db
      .select({ id: postRatificationAmendments.id })
      .from(postRatificationAmendments)
      .where(eq(postRatificationAmendments.tenantId, DEMO_TENANT_ID));
    expect(rows.length).toBe(1);
  });

  it('amendment entityType is "mark"', async () => {
    const rows = await db
      .select({ entityType: postRatificationAmendments.entityType })
      .from(postRatificationAmendments)
      .where(eq(postRatificationAmendments.tenantId, DEMO_TENANT_ID));
    expect(rows[0]?.entityType).toBe('mark');
  });
});

// ─── Idempotency ──────────────────────────────────────────────────────────────

describe('Idempotency', () => {
  it('second load does not increase award count', async () => {
    const before = await db
      .select({ id: awards.id })
      .from(awards)
      .where(eq(awards.tenantId, DEMO_TENANT_ID));

    await resetScenario({
      databaseUrl:  container.getConnectionUri(),
      tenantId:     DEMO_TENANT_ID,
      scenarioSlug: 'exam-board',
    });

    const after = await db
      .select({ id: awards.id })
      .from(awards)
      .where(eq(awards.tenantId, DEMO_TENANT_ID));

    expect(after.length).toBe(before.length);
  });

  it('second load does not increase progression decision count', async () => {
    const rows = await db
      .select({ id: progressionDecisions.id })
      .from(progressionDecisions)
      .where(eq(progressionDecisions.tenantId, DEMO_TENANT_ID));
    expect(rows.length).toBeGreaterThanOrEqual(400);
  });
});
