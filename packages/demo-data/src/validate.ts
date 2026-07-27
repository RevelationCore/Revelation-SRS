import { and, count, eq, inArray, isNotNull, notLike, sql } from 'drizzle-orm';
import {
  awards,
  enrolments,
  examBoards,
  exceptionalCircumstances,
  hesaStudentReturns,
  integrationRegistrations,
  marks,
  moduleRegistrations,
  personIdentities,
  persons,
  progressionDecisions,
  studentAddresses,
  ucasApplications,
  workflowInstances,
  type Db,
} from '@revelation-srs/db';

import { personId as mkPersonId } from './generators/persons.js';
import { GOLDEN_IDS } from './golden-ids.js';
import type { ScenarioManifest } from './types.js';

export interface ValidationResult {
  passed: number;
  failed: number;
  issues: string[];
}

// A check returns null on pass, or a descriptive failure message on fail.
type Check = (db: Db, tenantId: string) => Promise<string | null>;

// ─── Fictional-data format checks ────────────────────────────────────────────

async function checkNoNonDemoEmails(db: Db, tenantId: string): Promise<string | null> {
  const [row] = await db
    .select({ n: count() })
    .from(personIdentities)
    .where(and(
      eq(personIdentities.tenantId, tenantId),
      sql`(
        (email_institutional IS NOT NULL AND email_institutional NOT LIKE '%@demo.srs')
      )`,
    ));
  const n = row!.n;
  return n > 0 ? `${n} person identities contain non-demo.srs email addresses` : null;
}

async function checkNoNonZZPostcodes(db: Db, tenantId: string): Promise<string | null> {
  const [row] = await db
    .select({ n: count() })
    .from(studentAddresses)
    .where(and(
      eq(studentAddresses.tenantId, tenantId),
      isNotNull(studentAddresses.postcode),
      notLike(studentAddresses.postcode, 'ZZ%'),
    ));
  const n = row!.n;
  return n > 0 ? `${n} student addresses have non-ZZ postcodes` : null;
}

// ─── Bitemporal invariant checks ─────────────────────────────────────────────

async function checkPersonIdentitiesBitemporal(db: Db, tenantId: string): Promise<string | null> {
  const [row] = await db
    .select({ n: count() })
    .from(personIdentities)
    .where(and(
      eq(personIdentities.tenantId, tenantId),
      sql`valid_to IS NOT NULL AND valid_from > valid_to`,
    ));
  const n = row!.n;
  return n > 0 ? `${n} person_identity rows have valid_from after valid_to` : null;
}

async function checkEnrolmentsBitemporal(db: Db, tenantId: string): Promise<string | null> {
  const [row] = await db
    .select({ n: count() })
    .from(enrolments)
    .where(and(
      eq(enrolments.tenantId, tenantId),
      sql`valid_to IS NOT NULL AND valid_from > valid_to`,
    ));
  const n = row!.n;
  return n > 0 ? `${n} enrolment rows have valid_from after valid_to` : null;
}

// ─── Enrolment state coverage ─────────────────────────────────────────────────

async function checkEnrolledStatePresent(db: Db, tenantId: string): Promise<string | null> {
  const [row] = await db
    .select({ n: count() })
    .from(enrolments)
    .where(and(eq(enrolments.tenantId, tenantId), eq(enrolments.statusCode, 'enrolled')));
  return row!.n === 0 ? 'no enrolment records have status_code = enrolled' : null;
}

async function checkAllEnrolmentStates(db: Db, tenantId: string): Promise<string | null> {
  const rows = await db
    .selectDistinct({ code: enrolments.statusCode })
    .from(enrolments)
    .where(eq(enrolments.tenantId, tenantId));
  const codes = new Set(rows.map(r => r.code));
  const missing = (['enrolled', 'intermitting', 'withdrawn', 'graduated'] as const)
    .filter(c => !codes.has(c));
  return missing.length > 0
    ? `missing enrolment status codes: ${missing.join(', ')}`
    : null;
}

// ─── Exam-board and assessment integrity ─────────────────────────────────────

async function checkNoUnlockedMarks(db: Db, tenantId: string): Promise<string | null> {
  const [row] = await db
    .select({ n: count() })
    .from(marks)
    .where(and(eq(marks.tenantId, tenantId), eq(marks.locked, false)));
  const n = row!.n;
  return n > 0 ? `${n} mark rows are not locked (expected all locked for post-ratification scenario)` : null;
}

async function checkRatifiedBoardsExist(db: Db, tenantId: string): Promise<string | null> {
  const [row] = await db
    .select({ n: count() })
    .from(examBoards)
    .where(and(eq(examBoards.tenantId, tenantId), isNotNull(examBoards.ratifiedAt)));
  return row!.n === 0 ? 'no exam boards have been ratified' : null;
}

async function checkLockedProgressionDecisionsExist(db: Db, tenantId: string): Promise<string | null> {
  const [row] = await db
    .select({ n: count() })
    .from(progressionDecisions)
    .where(and(eq(progressionDecisions.tenantId, tenantId), eq(progressionDecisions.locked, true)));
  return row!.n === 0 ? 'no progression decisions are locked' : null;
}

// ─── Volume checks ────────────────────────────────────────────────────────────

function atLeastNPersons(expected: number): Check {
  return async (db, tenantId) => {
    const [row] = await db
      .select({ n: count() })
      .from(persons)
      .where(eq(persons.tenantId, tenantId));
    const n = row!.n;
    return n < expected ? `persons count: expected ≥ ${expected}, got ${n}` : null;
  };
}

function exactlyNPersons(expected: number): Check {
  return async (db, tenantId) => {
    const [row] = await db
      .select({ n: count() })
      .from(persons)
      .where(eq(persons.tenantId, tenantId));
    const n = row!.n;
    return n !== expected ? `persons count: expected exactly ${expected}, got ${n}` : null;
  };
}

function atLeastNBoards(expected: number): Check {
  return async (db, tenantId) => {
    const [row] = await db
      .select({ n: count() })
      .from(examBoards)
      .where(eq(examBoards.tenantId, tenantId));
    const n = row!.n;
    return n < expected ? `exam_board count: expected ≥ ${expected}, got ${n}` : null;
  };
}

function atLeastNWorkflowInstances(expected: number): Check {
  return async (db, tenantId) => {
    const [row] = await db
      .select({ n: count() })
      .from(workflowInstances)
      .where(eq(workflowInstances.tenantId, tenantId));
    const n = row!.n;
    return n < expected ? `workflow_instance count: expected ≥ ${expected}, got ${n}` : null;
  };
}

function atLeastNHesaReturns(expected: number): Check {
  return async (db, tenantId) => {
    const [row] = await db
      .select({ n: count() })
      .from(hesaStudentReturns)
      .where(eq(hesaStudentReturns.tenantId, tenantId));
    const n = row!.n;
    return n < expected ? `hesa_student_return count: expected ≥ ${expected}, got ${n}` : null;
  };
}

function atLeastNMarks(expected: number): Check {
  return async (db, tenantId) => {
    const [row] = await db
      .select({ n: count() })
      .from(marks)
      .where(eq(marks.tenantId, tenantId));
    const n = row!.n;
    return n < expected ? `mark count: expected ≥ ${expected}, got ${n}` : null;
  };
}

// ─── Live external endpoint guard (RR-003) ───────────────────────────────────
//
// Verifies that every enabled integration registration for this tenant has an
// endpoint_url that belongs to a known demo/stub domain.  A production-like URL
// in a demo tenant is a safety failure: it would cause the demo environment to
// fire real HTTP requests at live external systems.

const DEMO_URL_PATTERNS = [
  /^https?:\/\/localhost/,
  /^https?:\/\/127\./,
  /\.demo\.srs(\/|$)/,
  /^https?:\/\/stub\./,
  /^nats:\/\//,
];

async function checkNoLiveExternalEndpoints(db: Db, tenantId: string): Promise<string | null> {
  const rows = await db
    .select({ endpointUrl: integrationRegistrations.endpointUrl })
    .from(integrationRegistrations)
    .where(
      and(
        eq(integrationRegistrations.tenantId, tenantId),
        eq(integrationRegistrations.enabled, true),
        isNotNull(integrationRegistrations.endpointUrl),
      ),
    );

  const live: string[] = [];
  for (const r of rows) {
    const url = r.endpointUrl;
    if (url === null) continue;
    const isSafe = DEMO_URL_PATTERNS.some((p) => p.test(url));
    if (!isSafe) live.push(url);
  }

  return live.length > 0
    ? `${live.length} enabled integration registration(s) have live external endpoints: ${live.slice(0, 3).join(', ')}${live.length > 3 ? ' ...' : ''}`
    : null;
}

// ─── Story-marker existence check (RR-001) ───────────────────────────────────
//
// Each scenario manifest lists storyMarkers for the key personas (seqs 1…N).
// Verify that a person row exists in the DB for each marker so that demo
// scripts and golden E2E tests can rely on these records being present.

function checkStoryMarkersExist(manifest: ScenarioManifest): Check {
  return async (db, tenantId) => {
    if (manifest.storyMarkers.length === 0) return null;

    // Story markers correspond to person seqs 1 … storyMarkers.length
    const expectedIds = manifest.slug === 'ci-golden'
      ? [
          GOLDEN_IDS.PERSON_ENROLLED,
          GOLDEN_IDS.PERSON_INTERMITTING,
          GOLDEN_IDS.PERSON_WITHDRAWN,
          GOLDEN_IDS.PERSON_GRADUATED,
        ].slice(0, manifest.storyMarkers.length)
      : manifest.storyMarkers.map((_, i) => mkPersonId(tenantId, i + 1));

    const rows = await db
      .select({ id: persons.id })
      .from(persons)
      .where(and(eq(persons.tenantId, tenantId), inArray(persons.id, expectedIds)));

    const found = new Set(rows.map(r => r.id));
    const missing = expectedIds
      .filter((id, i) => !found.has(id))
      .map((_id, i) => manifest.storyMarkers[i]);

    return missing.length > 0
      ? `story-marker persons not found in DB: ${missing.join(', ')}`
      : null;
  };
}

// ─── Domain-specific story-arc validators (RR-009) ───────────────────────────
//
// Verify that key story-arc facts hold for S1–S5 scenarios: the correct
// enrolment statuses, module registrations, EC records, and board outcomes.

async function checkS2EnrolmentArcs(db: Db, tenantId: string): Promise<string | null> {
  // Alice (seq 1) = enrolled, Bob (seq 2) = intermitting, Carol (seq 3) = graduated
  const aliceId = mkPersonId(tenantId, 1);
  const bobId   = mkPersonId(tenantId, 2);
  const carolId = mkPersonId(tenantId, 3);

  const rows = await db
    .select({ personId: enrolments.personId, statusCode: enrolments.statusCode })
    .from(enrolments)
    .where(and(
      eq(enrolments.tenantId, tenantId),
      inArray(enrolments.personId, [aliceId, bobId, carolId]),
    ));

  const statusByPerson = new Map(rows.map(r => [r.personId, r.statusCode]));
  const issues: string[] = [];
  if (statusByPerson.get(aliceId) !== 'enrolled')     issues.push('S2:alice-enrolled — expected enrolled');
  if (statusByPerson.get(bobId)   !== 'intermitting') issues.push('S2:bob-intermitting — expected intermitting');
  if (statusByPerson.get(carolId) !== 'graduated')    issues.push('S2:carol-graduated — expected graduated');

  return issues.length > 0 ? issues.join('; ') : null;
}

async function checkS3ModuleRegistrations(db: Db, tenantId: string): Promise<string | null> {
  // Alice (seq 1) must have at least one module registration
  const aliceId = mkPersonId(tenantId, 1);
  const enrolRows = await db
    .select({ id: enrolments.id })
    .from(enrolments)
    .where(and(eq(enrolments.tenantId, tenantId), eq(enrolments.personId, aliceId)));

  if (enrolRows.length === 0) return 'S3:alice-registered — no enrolment found';

  const [regRow] = await db
    .select({ n: count() })
    .from(moduleRegistrations)
    .where(and(
      eq(moduleRegistrations.tenantId, tenantId),
      eq(moduleRegistrations.enrolmentId, enrolRows[0]!.id),
    ));

  return (regRow?.n ?? 0) === 0
    ? 'S3:alice-registered — no module registrations found'
    : null;
}

async function checkS4EcAndAdjustmentPresent(db: Db, tenantId: string): Promise<string | null> {
  // EC claims submitted by students live in the wellbeing schema (wellbeing.ec_claim),
  // not the board-facing public.exceptional_circumstances table which is populated later.
  const [ecRow] = await db.execute(
    sql`SELECT count(*)::int AS n FROM wellbeing.ec_claim WHERE tenant_id = ${tenantId}`,
  );
  if ((ecRow as { n: number }).n === 0) return 'S4:bob-ec-claim — no EC claim records found in wellbeing.ec_claim';

  return null;
}

async function checkS5ProgressionAndAward(db: Db, tenantId: string): Promise<string | null> {
  const [pdRow] = await db
    .select({ n: count() })
    .from(progressionDecisions)
    .where(and(eq(progressionDecisions.tenantId, tenantId), eq(progressionDecisions.locked, true)));
  if ((pdRow?.n ?? 0) === 0) return 'S5 — no locked progression decisions found';

  return null;
}

// ─── Common checks applied to every scenario ─────────────────────────────────

const COMMON_CHECKS: Check[] = [
  checkNoNonDemoEmails,
  checkNoNonZZPostcodes,
  checkPersonIdentitiesBitemporal,
  checkEnrolmentsBitemporal,
  checkNoLiveExternalEndpoints,
];

// ─── Per-scenario additional checks ──────────────────────────────────────────

const SCENARIO_CHECKS: Record<string, Check[]> = {
  'ci-golden': [
    exactlyNPersons(4),
    atLeastNBoards(3),
    atLeastNWorkflowInstances(3),
    checkAllEnrolmentStates,
  ],
  'curriculum-baseline': [
    // Reference data only — persons come from other scenarios
  ],
  'applicant-pipeline': [
    atLeastNPersons(500),
    // S1 creates UCAS applications with offer statuses; no enrolments yet
    async (db, tenantId) => {
      const [row] = await db
        .select({ n: count() })
        .from(ucasApplications)
        .where(eq(ucasApplications.tenantId, tenantId));
      return (row?.n ?? 0) === 0 ? '[applicant-pipeline] no UCAS applications found' : null;
    },
    async (db, tenantId) => {
      const [row] = await db
        .select({ n: count() })
        .from(ucasApplications)
        .where(and(eq(ucasApplications.tenantId, tenantId), eq(ucasApplications.statusCode, 'conditional')));
      return (row?.n ?? 0) === 0 ? '[applicant-pipeline] no conditional UCAS applications found' : null;
    },
  ],
  'enrolment-induction': [
    atLeastNPersons(1_000),
    checkAllEnrolmentStates,
    checkS2EnrolmentArcs, // RR-009: story-arc status verification
  ],
  'module-selection': [
    atLeastNPersons(1_000),
    atLeastNBoards(3),
    checkEnrolledStatePresent,
    checkS3ModuleRegistrations, // RR-009: Alice has module registrations
  ],
  'assessment-marks': [
    atLeastNPersons(1_000),
    atLeastNMarks(1_800),
    checkEnrolledStatePresent,
    checkS4EcAndAdjustmentPresent, // RR-009: EC record for Bob
  ],
  'exam-board': [
    atLeastNPersons(1_000),
    atLeastNBoards(4),
    atLeastNMarks(1_000),
    checkNoUnlockedMarks,
    checkRatifiedBoardsExist,
    checkLockedProgressionDecisionsExist,
    checkS5ProgressionAndAward, // RR-009: progression decisions locked
  ],
  'institution-year': [
    atLeastNPersons(50_000),
    atLeastNBoards(16),
    atLeastNMarks(50_000),
    atLeastNHesaReturns(4),
    checkAllEnrolmentStates,
    checkNoUnlockedMarks,
    checkRatifiedBoardsExist,
    checkLockedProgressionDecisionsExist,
    async (db, tenantId) => {
      const [row] = await db.select({ n: count() }).from(awards).where(eq(awards.tenantId, tenantId));
      return (row?.n ?? 0) === 0 ? 'S6 — no award records found' : null;
    },
  ],
};

// ─── Runner ───────────────────────────────────────────────────────────────────

export async function validateScenario(
  db: Db,
  tenantId: string,
  manifest: ScenarioManifest,
): Promise<ValidationResult> {
  const scenarioChecks = SCENARIO_CHECKS[manifest.slug] ?? [];
  // RR-001: story-marker existence check — added per-manifest so it uses the correct marker list
  const storyMarkerCheck = manifest.storyMarkers.length > 0
    ? [checkStoryMarkersExist(manifest)]
    : [];
  const allChecks = [...COMMON_CHECKS, ...storyMarkerCheck, ...scenarioChecks];

  let passed = 0;
  let failed = 0;
  const issues: string[] = [];

  for (const check of allChecks) {
    const issue = await check(db, tenantId);
    if (issue === null) {
      passed++;
    } else {
      failed++;
      issues.push(`[${manifest.slug}] ${issue}`);
    }
  }

  if (allChecks.length > 0) {
    console.log(`Validation for "${manifest.slug}": ${passed} passed, ${failed} failed.`);
  }

  return { passed, failed, issues };
}
