import {
  businessCases,
  enrolments,
  examinerAppointments,
  examinerReports,
  finalThesisDeposits,
  pgrCompletionCases,
  pgrExaminationCases,
  pgrExaminationOutcomes,
  pgrProgressReviews,
  pgrReviewMembers,
  pgrSupervisionCases,
  pgrSupervisorNominations,
  personIdentities,
  persons,
  programmes,
  researchMilestones,
  staffAssignments,
  studentAddresses,
  studentContactMethods,
  thesisCorrectionRequirements,
  thesisSubmissions,
  awards,
  vivaEvents,
  type Db,
} from '@revelation-srs/db';

import { flattenBundles, generatePersonBundle } from '../generators/index.js';
import { deterministicId } from '../generators/ids.js';
import { STORY_MARKERS } from '../story-markers.js';
import type { ScenarioManifest } from '../types.js';
import { batchInsert } from '../utils/batch.js';

export const manifest: ScenarioManifest = {
  slug:             'pgr-lifecycle',
  name:             'S7 — PGR Lifecycle',
  schemaVersion:    '0018',
  referenceDate:    '2029-06-01',
  academicYears:    ['2027-28', '2028-29', '2029-30'],
  targetVolumes: {
    students:          6,
    supervisors:       6,
    supervisionCases:  6,
    progressReviews:   1,
    examinationCases:  3,
    completionCases:   1,
    awards:            1,
  },
  loadTimeBudgetMs: 30_000,
  storyMarkers: [
    STORY_MARKERS.S7_PRIYA_SUPERVISION,
    STORY_MARKERS.S7_JORDAN_MILESTONE,
    STORY_MARKERS.S7_AVERY_AWARDED,
  ],
  phases: ['reference-data', 'persons', 'enrolments', 'pgr'],
};

// ─── Constants ────────────────────────────────────────────────────────────────

const ACTOR       = 'demo-data:pgr-lifecycle';
const OWNER       = 'demo-pgr-admin';
const ACADEMIC_YEAR = '2028-29';
const VALID_FROM  = new Date('2027-09-20T00:00:00Z');

const PROGRAMME_CODE = 'PHDCS';

// Student seqs (1-6) and supervisor/examiner seqs (101-106)
const STUDENTS = [
  { seq: 1, first: 'Priya',  last: 'Okafor' },   // supervision approved, active
  { seq: 2, first: 'Jordan', last: 'Blake' },    // supervision approved + satisfactory review + milestone
  { seq: 3, first: 'Taylor', last: 'Nguyen' },   // thesis submitted, examiners approved, one report in
  { seq: 4, first: 'Morgan', last: 'Hayes' },    // ratified pass-minor-corrections, correction outstanding
  { seq: 5, first: 'Avery',  last: 'Sullivan' }, // full lifecycle: completed and awarded
  { seq: 6, first: 'Sam',    last: 'Whitfield' }, // supervision nomination returned (exception path)
] as const;

const STAFF = [
  { seq: 101, first: 'Helena',  last: 'Cross' },     // principal supervisor (Priya, Jordan)
  { seq: 102, first: 'Marcus',  last: 'Webb' },       // principal supervisor (Taylor, Morgan, Avery)
  { seq: 103, first: 'Elena',   last: 'Vasquez' },    // internal examiner
  { seq: 104, first: 'David',   last: 'Okonkwo' },    // external examiner
  { seq: 105, first: 'Fiona',   last: 'Clarke' },     // independent reviewer / chair
  { seq: 106, first: 'Samuel',  last: 'Reed' },       // supervisor nominated then returned (Sam)
] as const;

function enrolmentId(tenantId: string, seq: number): string {
  return deterministicId('pgr-enrolment', tenantId, String(seq));
}

function businessCaseId(tenantId: string, kind: string, seq: number): string {
  return deterministicId('pgr-business-case', tenantId, kind, String(seq));
}

// ─── Load function ────────────────────────────────────────────────────────────

export async function load(
  db:       Db,
  tenantId: string,
  phase:    string,
  opts:     { dryRun?: boolean },
): Promise<void> {
  if (opts.dryRun) return;

  switch (phase) {
    case 'reference-data': return loadReferenceData(db, tenantId);
    case 'persons':        return loadPersons(db, tenantId);
    case 'enrolments':     return loadEnrolments(db, tenantId);
    case 'pgr':            return loadPgr(db, tenantId);
    default:               return;
  }
}

// ─── Phase: reference-data ────────────────────────────────────────────────────
// A single self-contained research-degree programme — deliberately not added
// to the shared BASELINE_PROGRAMMES catalogue used by taught-programme
// scenarios, since PGR has no modules/offerings of its own.

function programmeId(tenantId: string): string {
  return deterministicId('pgr-programme', tenantId, PROGRAMME_CODE);
}

async function loadReferenceData(db: Db, tenantId: string): Promise<void> {
  const now = VALID_FROM;
  await batchInsert(db, programmes, [{
    versionId:             programmeId(tenantId),
    id:                    programmeId(tenantId),
    tenantId,
    code:                  PROGRAMME_CODE,
    title:                 'DEMO - PhD Computer Science',
    qualificationTypeCode: '100', // HESA: research-based higher degree (doctoral)
    owningSchool:          'School of Computer Science',
    fheqLevel:             8,
    creditTotal:           null,
    durationYears:         3,
    modeOfStudyCode:       'full-time',
    validFrom:             now,
    validTo:               null,
    recordedAt:            now,
    recordedUntil:         null,
  }]);
}

// ─── Phase: persons ───────────────────────────────────────────────────────────

async function loadPersons(db: Db, tenantId: string): Promise<void> {
  const bundles = [
    ...STUDENTS.map(s => generatePersonBundle(tenantId, s.seq, {
      statusCode: s.seq === 5 ? 'graduated' : 'enrolled',
      sourceSystem: 'direct',
      includeTermAddress: true,
      validFrom: VALID_FROM,
    })),
    ...STAFF.map(s => generatePersonBundle(tenantId, s.seq, {
      statusCode: 'enrolled', // staff records reuse the same person/identity shape as students
      sourceSystem: 'direct',
      includeTermAddress: false,
      validFrom: VALID_FROM,
    })),
  ];
  const flat = flattenBundles(bundles);
  await batchInsert(db, persons,               flat.persons);
  await batchInsert(db, personIdentities,      flat.identities);
  await batchInsert(db, studentAddresses,      flat.addresses);
  await batchInsert(db, studentContactMethods, flat.contactMethods);
}

// ─── Phase: enrolments ────────────────────────────────────────────────────────

async function loadEnrolments(db: Db, tenantId: string): Promise<void> {
  const pId = programmeId(tenantId);
  const rows = STUDENTS.map(s => ({
    id:                  enrolmentId(tenantId, s.seq),
    tenantId,
    personId:            deterministicId('person', tenantId, String(s.seq)),
    programmeId:         pId,
    statusCode:          s.seq === 5 ? 'graduated' : 'enrolled',
    modeOfStudyCode:     'full-time',
    academicYearOfEntry: '2027-28',
    startDate:           '2027-09-20',
    feeBandCode:         'home-postgraduate-research',
    validFrom:           VALID_FROM,
    recordedAt:          VALID_FROM,
  }));
  await batchInsert(db, enrolments, rows);
}

// ─── Phase: pgr ───────────────────────────────────────────────────────────────
// Each case is seeded as a single current business_case row reflecting its
// final demo status directly (no simulated decision history) — read paths
// only ever consult the current row, so this is a faithful, low-risk
// simplification for demo purposes. Real approval/decision history is
// exercised by the integration test suite, not demo data.

function personRef(tenantId: string, seq: number): string {
  return deterministicId('person', tenantId, String(seq));
}

async function loadPgr(db: Db, tenantId: string): Promise<void> {
  const now = new Date(manifest.referenceDate + 'T09:00:00Z');
  const priya  = STUDENTS[0]!;
  const jordan = STUDENTS[1]!;
  const taylor = STUDENTS[2]!;
  const morgan = STUDENTS[3]!;
  const avery  = STUDENTS[4]!;
  const sam    = STUDENTS[5]!;

  const helena = STAFF[0]!;
  const marcus = STAFF[1]!;
  const elena  = STAFF[2]!;
  const david  = STAFF[3]!;
  const fiona  = STAFF[4]!;
  const samuel = STAFF[5]!;

  // ── Supervision cases (one per student except Sam's is 'returned') ─────────
  const supervisionCaseIds = new Map<number, string>();
  const businessCaseRows: (typeof businessCases.$inferInsert)[] = [];
  const supervisionCaseRows: (typeof pgrSupervisionCases.$inferInsert)[] = [];
  const nominationRows: (typeof pgrSupervisorNominations.$inferInsert)[] = [];
  const assignmentRows: (typeof staffAssignments.$inferInsert)[] = [];

  function addSupervisionCase(
    student: { seq: number },
    supervisor: { seq: number },
    statusCode: 'approved' | 'returned',
    researchArea: string,
  ): void {
    const bcId = businessCaseId(tenantId, 'supervision', student.seq);
    const caseId = deterministicId('pgr-supervision-case', tenantId, String(student.seq));
    supervisionCaseIds.set(student.seq, caseId);

    businessCaseRows.push({
      versionId: bcId, id: bcId, tenantId,
      subjectType: 'enrolment', subjectId: enrolmentId(tenantId, student.seq),
      processId: 'BP-03-007', statusCode, ownerId: OWNER, actorId: ACTOR,
      validFrom: now, validTo: null, recordedAt: now, recordedUntil: null,
    });
    supervisionCaseRows.push({
      id: caseId, tenantId, businessCaseId: bcId,
      enrolmentId: enrolmentId(tenantId, student.seq),
      degreeAim: 'PhD', researchArea, schoolOwner: 'School of Computer Science',
      intendedStartDate: '2027-09-20', createdAt: now,
    });
    nominationRows.push({
      id: deterministicId('pgr-nomination', tenantId, String(student.seq)),
      tenantId, supervisionCaseId: caseId, personId: personRef(tenantId, supervisor.seq),
      roleDetailCode: 'principal', orgOwner: 'School of Computer Science',
      eligibilityCheckedAt: now, nominatedBy: ACTOR, nominatedAt: now,
    });
    if (statusCode === 'approved') {
      // Assignments start at the project's intended start date. Avery's is
      // end-dated at the demo reference date to reflect closure on
      // completion — closeCurrentAssignments never overwrites in place, it
      // end-dates, so recorded_until/valid_to must be strictly after
      // recorded_at/valid_from, never equal to it.
      const isAvery = avery.seq === student.seq;
      assignmentRows.push({
        versionId: deterministicId('pgr-assignment', tenantId, String(student.seq)),
        id:        deterministicId('pgr-assignment', tenantId, String(student.seq)),
        tenantId, enrolmentId: enrolmentId(tenantId, student.seq), supervisionCaseId: caseId,
        personId: personRef(tenantId, supervisor.seq),
        assignmentTypeCode: 'supervisor', roleDetailCode: 'principal',
        orgOwner: 'School of Computer Science', externalOrganisation: null,
        contractualStatusCode: null, accessLevelCode: null, actorId: ACTOR,
        validFrom: VALID_FROM, validTo: isAvery ? now : null,
        recordedAt: VALID_FROM, recordedUntil: isAvery ? now : null,
      });
    }
  }

  addSupervisionCase(priya,  helena, 'approved', 'Distributed systems reliability');
  addSupervisionCase(jordan, helena, 'approved', 'Human-computer interaction for accessibility');
  addSupervisionCase(taylor, marcus, 'approved', 'Machine learning for medical imaging');
  addSupervisionCase(morgan, marcus, 'approved', 'Formal verification of concurrent systems');
  addSupervisionCase(avery,  marcus, 'approved', 'Natural language processing for low-resource languages');
  addSupervisionCase(sam,    samuel, 'returned', 'Quantum algorithm design');

  // ── Progress review (Jordan: satisfactory annual review + milestone) ───────
  const jordanReviewBcId = businessCaseId(tenantId, 'review', jordan.seq);
  const jordanReviewId   = deterministicId('pgr-progress-review', tenantId, String(jordan.seq));
  businessCaseRows.push({
    versionId: jordanReviewBcId, id: jordanReviewBcId, tenantId,
    subjectType: 'enrolment', subjectId: enrolmentId(tenantId, jordan.seq),
    processId: 'BP-04-003', statusCode: 'satisfactory', ownerId: OWNER, actorId: ACTOR,
    validFrom: now, validTo: null, recordedAt: now, recordedUntil: null,
  });
  const reviewRows: (typeof pgrProgressReviews.$inferInsert)[] = [{
    id: jordanReviewId, tenantId, businessCaseId: jordanReviewBcId,
    enrolmentId: enrolmentId(tenantId, jordan.seq),
    supervisionCaseId: supervisionCaseIds.get(jordan.seq)!,
    reviewTypeCode: 'annual', createdAt: now,
  }];
  const reviewMemberRows: (typeof pgrReviewMembers.$inferInsert)[] = [{
    id: deterministicId('pgr-review-member', tenantId, String(jordan.seq)),
    tenantId, reviewId: jordanReviewId, personId: personRef(tenantId, fiona.seq),
    roleCode: 'independent-reviewer', conflictTypeCode: null, declaredAt: null,
    recusedAt: null, addedBy: ACTOR, addedAt: now,
  }];
  const milestoneRows: (typeof researchMilestones.$inferInsert)[] = [{
    id: deterministicId('pgr-milestone', tenantId, String(jordan.seq)),
    tenantId, enrolmentId: enrolmentId(tenantId, jordan.seq), reviewId: jordanReviewId,
    milestoneTypeCode: 'confirmation-of-registration', achievedDate: '2028-10-01',
    publishedAt: now, actorId: ACTOR, createdAt: now,
  }];

  // ── Examination cases (Taylor: mid-examination; Morgan: minor corrections
  //    outstanding; Avery: fully completed and awarded) ───────────────────────
  const examinationCaseIds = new Map<number, string>();
  const examinationCaseRows: (typeof pgrExaminationCases.$inferInsert)[] = [];
  const thesisSubmissionRows: (typeof thesisSubmissions.$inferInsert)[] = [];
  const examinerAppointmentRows: (typeof examinerAppointments.$inferInsert)[] = [];
  const examinerReportRows: (typeof examinerReports.$inferInsert)[] = [];
  const vivaEventRows: (typeof vivaEvents.$inferInsert)[] = [];
  const outcomeRows: (typeof pgrExaminationOutcomes.$inferInsert)[] = [];
  const correctionRows: (typeof thesisCorrectionRequirements.$inferInsert)[] = [];

  function addExaminationCase(
    student: { seq: number },
    statusCode: 'examiners-confirmed' | 'viva-held' | 'pass-minor-corrections' | 'pass',
  ): string {
    const bcId = businessCaseId(tenantId, 'examination', student.seq);
    const caseId = deterministicId('pgr-examination-case', tenantId, String(student.seq));
    examinationCaseIds.set(student.seq, caseId);

    businessCaseRows.push({
      versionId: bcId, id: bcId, tenantId,
      subjectType: 'enrolment', subjectId: enrolmentId(tenantId, student.seq),
      processId: 'BP-05-010', statusCode, ownerId: OWNER, actorId: ACTOR,
      validFrom: now, validTo: null, recordedAt: now, recordedUntil: null,
    });
    examinationCaseRows.push({
      id: caseId, tenantId, businessCaseId: bcId,
      enrolmentId: enrolmentId(tenantId, student.seq), createdAt: now,
    });
    thesisSubmissionRows.push({
      id: deterministicId('pgr-thesis-submission', tenantId, String(student.seq)),
      tenantId, examinationCaseId: caseId, versionNumber: 1, formatCode: 'traditional',
      declarationConfirmed: true, restricted: false, restrictionReasonText: null,
      restrictionReviewDate: null, storageRef: `repo://demo-thesis/${student.seq}`,
      submittedBy: ACTOR, submittedAt: now,
    });

    const internalAppointmentId = deterministicId('pgr-examiner-appointment', tenantId, String(student.seq), 'internal');
    const externalAppointmentId = deterministicId('pgr-examiner-appointment', tenantId, String(student.seq), 'external');
    examinerAppointmentRows.push(
      {
        id: internalAppointmentId, tenantId, examinationCaseId: caseId,
        personId: personRef(tenantId, elena.seq), examinerRoleCode: 'internal',
        independenceCheckedAt: now, conflictTypeCode: null, recusedAt: null,
        confirmedAt: now, nominatedBy: ACTOR, nominatedAt: now,
      },
      {
        id: externalAppointmentId, tenantId, examinationCaseId: caseId,
        personId: personRef(tenantId, david.seq), examinerRoleCode: 'external',
        independenceCheckedAt: now, conflictTypeCode: null, recusedAt: null,
        confirmedAt: now, nominatedBy: ACTOR, nominatedAt: now,
      },
    );

    if (statusCode !== 'examiners-confirmed') {
      examinerReportRows.push(
        {
          id: deterministicId('pgr-examiner-report', tenantId, String(student.seq), 'internal'),
          tenantId, examinationCaseId: caseId, examinerAppointmentId: internalAppointmentId,
          reportRef: `workspace://demo-report/${student.seq}/internal`, recommendationCode: 'pass',
          submittedAt: now,
        },
        {
          id: deterministicId('pgr-examiner-report', tenantId, String(student.seq), 'external'),
          tenantId, examinationCaseId: caseId, examinerAppointmentId: externalAppointmentId,
          reportRef: `workspace://demo-report/${student.seq}/external`, recommendationCode: 'pass',
          submittedAt: now,
        },
      );
    } else {
      // Taylor: mid-examination — only the internal examiner has reported so far.
      examinerReportRows.push({
        id: deterministicId('pgr-examiner-report', tenantId, String(student.seq), 'internal'),
        tenantId, examinationCaseId: caseId, examinerAppointmentId: internalAppointmentId,
        reportRef: `workspace://demo-report/${student.seq}/internal`, recommendationCode: null,
        submittedAt: now,
      });
    }

    if (statusCode === 'viva-held' || statusCode === 'pass-minor-corrections' || statusCode === 'pass') {
      vivaEventRows.push({
        id: deterministicId('pgr-viva-event', tenantId, String(student.seq)),
        tenantId, examinationCaseId: caseId, heldAt: now,
        jointRecommendationText: 'Recommend award subject to any required corrections',
        recordedBy: ACTOR, recordedAt: now,
      });
    }

    if (statusCode === 'pass-minor-corrections' || statusCode === 'pass') {
      const outcomeId = deterministicId('pgr-examination-outcome', tenantId, String(student.seq));
      outcomeRows.push({
        id: outcomeId, tenantId, examinationCaseId: caseId,
        outcomeCode: statusCode, decidedBy: ACTOR, decidedAt: now,
      });
      if (statusCode === 'pass-minor-corrections') {
        correctionRows.push({
          id: deterministicId('pgr-correction-requirement', tenantId, String(student.seq)),
          tenantId, outcomeId, deadlineDate: '2029-09-01',
          completedAt: null, completedBy: null, createdAt: now,
        });
      }
      return outcomeId;
    }
    return '';
  }

  addExaminationCase(taylor, 'examiners-confirmed');
  const morganOutcomeId = addExaminationCase(morgan, 'pass-minor-corrections');
  const averyOutcomeId  = addExaminationCase(avery,  'pass');
  void morganOutcomeId;

  // ── Completion and award (Avery only) ───────────────────────────────────────
  const completionBcId = businessCaseId(tenantId, 'completion', avery.seq);
  const completionCaseId = deterministicId('pgr-completion-case', tenantId, String(avery.seq));
  businessCaseRows.push({
    versionId: completionBcId, id: completionBcId, tenantId,
    subjectType: 'enrolment', subjectId: enrolmentId(tenantId, avery.seq),
    processId: 'BP-06-006', statusCode: 'award-conferred', ownerId: OWNER, actorId: ACTOR,
    validFrom: now, validTo: null, recordedAt: now, recordedUntil: null,
  });
  const completionCaseRows: (typeof pgrCompletionCases.$inferInsert)[] = [{
    id: completionCaseId, tenantId, businessCaseId: completionBcId,
    enrolmentId: enrolmentId(tenantId, avery.seq),
    examinationCaseId: examinationCaseIds.get(avery.seq)!, createdAt: now,
  }];
  const depositRows: (typeof finalThesisDeposits.$inferInsert)[] = [{
    id: deterministicId('pgr-final-deposit', tenantId, String(avery.seq)),
    tenantId, completionCaseId, depositRef: `repo://demo-final-thesis/${avery.seq}`,
    ipDeclarationConfirmed: true, confirmedBy: ACTOR, confirmedAt: now,
  }];
  const awardRows: (typeof awards.$inferInsert)[] = [{
    versionId: deterministicId('pgr-award', tenantId, String(avery.seq)),
    id:        deterministicId('pgr-award', tenantId, String(avery.seq)),
    tenantId, enrolmentId: enrolmentId(tenantId, avery.seq),
    personId: personRef(tenantId, avery.seq),
    examBoardId: null, sourceCaseId: completionCaseId,
    qualificationCode: 'PhD', classificationCode: 'pass', awardDate: '2029-07-15',
    hearGeneratedAt: null, certificateIssuedAt: null, hearDocument: null,
    actorId: ACTOR, validFrom: now, validTo: null, recordedAt: now, recordedUntil: null,
  }];
  void averyOutcomeId;

  // ── Persist ──────────────────────────────────────────────────────────────────
  await batchInsert(db, businessCases,               businessCaseRows);
  await batchInsert(db, pgrSupervisionCases,          supervisionCaseRows);
  await batchInsert(db, pgrSupervisorNominations,     nominationRows);
  await batchInsert(db, staffAssignments,             assignmentRows);
  await batchInsert(db, pgrProgressReviews,           reviewRows);
  await batchInsert(db, pgrReviewMembers,             reviewMemberRows);
  await batchInsert(db, researchMilestones,           milestoneRows);
  await batchInsert(db, pgrExaminationCases,          examinationCaseRows);
  await batchInsert(db, thesisSubmissions,            thesisSubmissionRows);
  await batchInsert(db, examinerAppointments,         examinerAppointmentRows);
  await batchInsert(db, examinerReports,              examinerReportRows);
  await batchInsert(db, vivaEvents,                   vivaEventRows);
  await batchInsert(db, pgrExaminationOutcomes,       outcomeRows);
  await batchInsert(db, thesisCorrectionRequirements, correctionRows);
  await batchInsert(db, pgrCompletionCases,           completionCaseRows);
  await batchInsert(db, finalThesisDeposits,          depositRows);
  await batchInsert(db, awards,                       awardRows);
}
