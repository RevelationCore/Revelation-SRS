import { eq } from 'drizzle-orm';
import {
  academicPeriods,
  assessmentComponents,
  awardingBodies,
  awards,
  enrolments,
  examBoardCandidateProfiles,
  examBoardDataPacks,
  examBoardMemberAttendance,
  examBoards,
  examEntries,
  externalExaminerSignoffs,
  integrationExchanges,
  integrationRegistrations,
  marks,
  moduleOfferings,
  moduleRegistrations,
  moduleResults,
  modules,
  personIdentities,
  persons,
  postRatificationAmendments,
  postRatificationCases,
  progressionDecisions,
  programmes,
  reasonableAdjustments,
  studentAddresses,
  studentContactMethods,
  type Db,
} from '@revelation-srs/db';

import {
  // ID helpers
  assessmentComponentId,
  awardBoardId,
  markLogicalId,
  moduleOfferingId,
  moduleRegistrationId,
  personId as mkPersonId,
  postRatificationCaseLogicalId,
  programmeId as mkProgrammeId,
  progressionDecisionCode,
  vleRegistrationId,
  // Generators
  buildVleExchange,
  buildVleRegistration,
  classificationCode,
  flattenBundles,
  generateAdjustmentCase,
  generateAward,
  generateAwardBoard,
  generateCandidateProfile,
  generateComponentsForOffering,
  generateCurriculum,
  generateDataPack,
  generateDisabilitySupportCase,
  generateEcClaim,
  generateExamBoards,
  generateExamEntry,
  generateExternalExaminerSignoff,
  generateMark,
  generateMemberAttendance,
  generateMentalHealthCase,
  generateModuleResult,
  generateMultiYearCalendar,
  generatePersonBundle,
  generatePostRatificationAmendment,
  generatePostRatificationCase,
  generateProgressionDecision,
  generateRegistrationsForStudent,
  generateWellbeingCase,
  getModuleOfferingsForYear,
  hasEcClaim,
  hasMentalHealthCase,
  hasWellbeingCase,
  lookupVleContractId,
  qualCodeForProgramme,
  rawMarkForSlot,
  ucasPersonalId,
  wellbeingSchemaExists,
  examBoardIdForPeriod,
  // Catalogue constants
  AUTUMN_MODULES,
  BASELINE_PROGRAMMES,
} from '../generators/index.js';
import {
  adjustmentCasesTable,
  disabilitySupportCasesTable,
  ecClaimsTable,
  mentalHealthCasesTable,
  wellbeingCasesTable,
} from '../generators/wellbeing.js';
import { provisionPersonas } from '../generators/keycloak.js';
import { STORY_MARKERS } from '../story-markers.js';
import type { ScenarioManifest } from '../types.js';
import { batchInsert } from '../utils/batch.js';
import { deterministicId } from '../generators/ids.js';

export const manifest: ScenarioManifest = {
  slug:             'exam-board',
  name:             'S5 — Exam Board and Ratification',
  schemaVersion:    '0023',
  referenceDate:    '2026-07-31',
  academicYears:    ['2024-25', '2025-26'],
  targetVolumes:    {
    students:              1_000,
    enrolments:            1_000,
    moduleRegistrations:   2_000,
    assessmentComponents:     80,
    marks:                 1_600,
    moduleResults:           800,
    examBoards:                4,
    dataPacks:                 3,
    candidateProfiles:       700,
    progressionDecisions:    650,
    awards:                  200,
    postRatificationCases:     3,
  },
  loadTimeBudgetMs: 300_000,
  storyMarkers:     [
    STORY_MARKERS.S5_ALICE_PROGRESSED,
    STORY_MARKERS.S5_BOB_RESIT,
    STORY_MARKERS.S5_CAROL_PROFILE,
  ],
  phases: [
    'reference-data',
    'personas',
    'persons',
    'enrolments',
    'registrations',
    'assessment',
    'wellbeing',
    'integration',
    'boards',
    'progression',
    'corrections',
  ],
};

// ─── Constants ────────────────────────────────────────────────────────────────

const TOTAL_STUDENTS = 1_000;
const ACADEMIC_YEAR  = '2025-26';
const VALID_FROM     = new Date('2025-08-01T00:00:00Z');
const MARK_DATE      = new Date('2026-01-30T00:00:00Z');
const ACTOR          = 'demo-data:exam-board';

const AUTUMN_RATIFIED_AT = new Date('2026-02-15T10:00:00Z');
const SPRING_RATIFIED_AT = new Date('2026-06-10T10:00:00Z');
const AWARD_RATIFIED_AT  = new Date('2026-07-15T10:00:00Z');

// ─── Helpers (mirrors S4 distribution exactly) ────────────────────────────────

function statusCodeForSeq(seq: number): 'enrolled' | 'intermitting' | 'withdrawn' | 'graduated' {
  const r = seq % 20;
  if (r <= 12) return 'enrolled';
  if (r === 13) return 'intermitting';
  if (r <= 15)  return 'withdrawn';
  return 'graduated';
}

function modeOfStudyForSeq(seq: number): string {
  const r = seq % 20;
  if (r <= 16) return 'full-time';
  if (r === 17) return 'part-time';
  if (r === 18) return 'distance';
  return 'sandwich';
}

function isInternationalForSeq(seq: number): boolean {
  return seq % 25 === 0;
}

function academicYearOfEntryForSeq(seq: number, status: string): string {
  if (status === 'graduated')    return '2022-23';
  if (status === 'withdrawn')    return '2024-25';
  if (status === 'intermitting') return '2024-25';
  return seq % 3 === 0 ? '2025-26' : '2024-25';
}

function yearOfStudyForSeq(seq: number): string {
  const entryYr = parseInt(academicYearOfEntryForSeq(seq, 'enrolled').split('-')[0]!, 10);
  return String(2025 - entryYr + 1);
}

function enrolmentId(tenantId: string, seq: number): string {
  return deterministicId('s5-enrolment', tenantId, String(seq));
}

function reasonableAdjustmentId(tenantId: string, seq: number): string {
  return deterministicId('s5-adjustment', tenantId, String(seq));
}

// Slot overrides for story-marker students (same as S4)
function slotOverridesForSeq(seq: number): { slot0Status?: string; slot1Status?: string } | undefined {
  if (seq === 1) return {};
  if (seq === 2) return { slot1Status: 'registered' };
  if (seq === 3) return { slot0Status: 'override' };
  return undefined;
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
    case 'personas':       return loadPersonas();
    case 'persons':        return loadPersons(db, tenantId);
    case 'enrolments':     return loadEnrolments(db, tenantId);
    case 'registrations':  return loadRegistrations(db, tenantId);
    case 'assessment':     return loadAssessment(db, tenantId);
    case 'wellbeing':      return loadWellbeing(db, tenantId);
    case 'integration':    return loadIntegration(db, tenantId);
    case 'boards':         return loadBoards(db, tenantId);
    case 'progression':    return loadProgression(db, tenantId);
    case 'corrections':    return loadCorrections(db, tenantId);
    default:               return;
  }
}

// ─── Phase: reference-data ────────────────────────────────────────────────────

async function loadReferenceData(db: Db, tenantId: string): Promise<void> {
  const calendar   = generateMultiYearCalendar(tenantId, manifest.academicYears);
  const curriculum = generateCurriculum(tenantId, manifest.academicYears);
  await batchInsert(db, academicPeriods,  calendar);
  await batchInsert(db, awardingBodies,   curriculum.awardingBodies);
  await batchInsert(db, programmes,       curriculum.programmes);
  await batchInsert(db, modules,          curriculum.modules);
  await batchInsert(db, moduleOfferings,  curriculum.moduleOfferings);
}

// ─── Phase: personas ──────────────────────────────────────────────────────────

async function loadPersonas(): Promise<void> {
  await provisionPersonas({ hardFail: process.env['KEYCLOAK_REQUIRED'] === 'true' });
}

// ─── Phase: persons ───────────────────────────────────────────────────────────

async function loadPersons(db: Db, tenantId: string): Promise<void> {
  const bundles = [];
  for (const sm of [
    { seq: 1, personaSource: ucasPersonalId(1) },
    { seq: 2, personaSource: ucasPersonalId(2) },
    { seq: 3, personaSource: ucasPersonalId(3) },
  ]) {
    bundles.push(generatePersonBundle(tenantId, sm.seq, {
      statusCode: 'enrolled', sourceSystem: 'ucas',
      sourceReference: sm.personaSource, includeTermAddress: true, validFrom: VALID_FROM,
    }));
  }
  for (let seq = 4; seq <= TOTAL_STUDENTS; seq++) {
    const status   = statusCodeForSeq(seq);
    const isIntl   = isInternationalForSeq(seq);
    const isUcas   = !isIntl && seq % 9 !== 0;
    const isActive = status === 'enrolled' || status === 'intermitting';
    bundles.push(generatePersonBundle(tenantId, seq, {
      statusCode:         status,
      sourceSystem:       isIntl ? 'international' : (isUcas ? 'ucas' : 'direct'),
      ...(isUcas ? { sourceReference: ucasPersonalId(seq) } : {}),
      includeTermAddress: isActive,
      validFrom:          VALID_FROM,
    }));
  }
  const flat = flattenBundles(bundles);
  await batchInsert(db, persons,               flat.persons);
  await batchInsert(db, personIdentities,      flat.identities);
  await batchInsert(db, studentAddresses,      flat.addresses);
  await batchInsert(db, studentContactMethods, flat.contactMethods);
}

// ─── Phase: enrolments ────────────────────────────────────────────────────────

async function loadEnrolments(db: Db, tenantId: string): Promise<void> {
  const rows = Array.from({ length: TOTAL_STUDENTS }, (_, i) => {
    const seq       = i + 1;
    const status    = statusCodeForSeq(seq);
    const entryYear = academicYearOfEntryForSeq(seq, status);
    const startYear = parseInt(entryYear.split('-')[0]!, 10);
    const pCode     = BASELINE_PROGRAMMES[seq % BASELINE_PROGRAMMES.length]!.code;
    return {
      id:                  enrolmentId(tenantId, seq),
      tenantId,
      personId:            mkPersonId(tenantId, seq),
      programmeId:         mkProgrammeId(tenantId, pCode),
      statusCode:          status,
      modeOfStudyCode:     modeOfStudyForSeq(seq),
      academicYearOfEntry: entryYear,
      startDate:           `${startYear}-09-23`,
      feeBandCode:         'home',
      fundingSourceCode:   'slc',
      ucasPersonalId:      isInternationalForSeq(seq) ? null : ucasPersonalId(seq),
      validFrom:           VALID_FROM,
      recordedAt:          VALID_FROM,
    };
  });
  await batchInsert(db, enrolments, rows);
}

// ─── Phase: registrations ─────────────────────────────────────────────────────

async function loadRegistrations(db: Db, tenantId: string): Promise<void> {
  const allRegistrations = [];
  const moduleBoards     = generateExamBoards(tenantId, ACADEMIC_YEAR);
  const awardBoard       = generateAwardBoard(tenantId, ACADEMIC_YEAR);
  const allExamEntries   = [];

  for (let seq = 1; seq <= TOTAL_STUDENTS; seq++) {
    if (statusCodeForSeq(seq) !== 'enrolled') continue;
    const enrollId = enrolmentId(tenantId, seq);
    const slots    = generateRegistrationsForStudent(
      tenantId, seq, enrollId, ACADEMIC_YEAR, slotOverridesForSeq(seq),
    );
    for (const s of slots) {
      allRegistrations.push(s.registration);
      const regStatus = s.registration.statusCode;
      if (regStatus === 'registered' || regStatus === 'override') {
        const boardId = examBoardIdForPeriod(tenantId, ACADEMIC_YEAR, s.termCode);
        allExamEntries.push(generateExamEntry(tenantId, seq, s, boardId));
      }
    }
  }

  await batchInsert(db, moduleRegistrations, allRegistrations);
  await batchInsert(db, examBoards,          [...moduleBoards, awardBoard]);
  await batchInsert(db, examEntries,         allExamEntries);
}

// ─── Phase: assessment ────────────────────────────────────────────────────────
// Marks and module results are inserted as locked=true — both module boards
// have been ratified by the S5 reference date of 2026-07-31.

async function loadAssessment(db: Db, tenantId: string): Promise<void> {
  const offerings      = getModuleOfferingsForYear(tenantId, ACADEMIC_YEAR);
  const componentPairs = offerings.map(o =>
    generateComponentsForOffering(tenantId, o.offeringId, o.title, MARK_DATE),
  );
  await batchInsert(db, assessmentComponents, componentPairs.flatMap(p => [p.coursework, p.exam]));

  const componentsByOffering = new Map<string, [string, string]>();
  for (const p of componentPairs) {
    componentsByOffering.set(p.coursework.moduleOfferingId, [p.coursework.id!, p.exam.id!]);
  }

  const allMarks:   typeof marks.$inferInsert[]         = [];
  const allResults: typeof moduleResults.$inferInsert[] = [];

  for (let seq = 1; seq <= TOTAL_STUDENTS; seq++) {
    if (statusCodeForSeq(seq) !== 'enrolled') continue;
    const enrollId = enrolmentId(tenantId, seq);
    const slots    = generateRegistrationsForStudent(
      tenantId, seq, enrollId, ACADEMIC_YEAR, slotOverridesForSeq(seq),
    );
    for (const s of slots) {
      const regStatus = s.registration.statusCode;
      if (regStatus !== 'registered' && regStatus !== 'override') continue;

      const compIds = componentsByOffering.get(s.registration.moduleOfferingId);
      if (!compIds) continue;

      const cwMark   = rawMarkForSlot(seq, s.slot, 0);
      const examMark = rawMarkForSlot(seq, s.slot, 1);

      allMarks.push({ ...generateMark(tenantId, s.registration.id, compIds[0], seq, s.slot, 0, MARK_DATE), locked: true });
      allMarks.push({ ...generateMark(tenantId, s.registration.id, compIds[1], seq, s.slot, 1, MARK_DATE), locked: true });
      allResults.push({ ...generateModuleResult(tenantId, s.registration.id, cwMark, examMark, MARK_DATE), locked: true });
    }
  }

  await batchInsert(db, marks,         allMarks);
  await batchInsert(db, moduleResults, allResults);
}

// ─── Phase: wellbeing ─────────────────────────────────────────────────────────

async function loadWellbeing(db: Db, tenantId: string): Promise<void> {
  const schemaOk = await wellbeingSchemaExists(db);
  if (!schemaOk) {
    console.warn('[demo-data] wellbeing schema not found — skipping wellbeing phase');
    return;
  }

  const wellbeingCaseRows:  typeof wellbeingCasesTable.$inferInsert[]         = [];
  const disabilityRows:      typeof disabilitySupportCasesTable.$inferInsert[] = [];
  const adjustmentCaseRows: typeof adjustmentCasesTable.$inferInsert[]        = [];
  const mentalHealthRows:    typeof mentalHealthCasesTable.$inferInsert[]      = [];
  const ecClaimRows:         typeof ecClaimsTable.$inferInsert[]               = [];
  const srsAdjRows:          typeof reasonableAdjustments.$inferInsert[]       = [];

  for (let seq = 1; seq <= TOTAL_STUDENTS; seq++) {
    if (statusCodeForSeq(seq) !== 'enrolled') continue;
    const isBob   = seq === 2;
    const isCarol = seq === 3;
    if (!hasWellbeingCase(seq) && !isBob && !isCarol) continue;

    const pId      = mkPersonId(tenantId, seq);
    const enrollId = enrolmentId(tenantId, seq);

    wellbeingCaseRows.push(generateWellbeingCase(tenantId, pId, seq));

    if (!isBob) {
      disabilityRows.push(generateDisabilitySupportCase(tenantId, pId, seq));
      adjustmentCaseRows.push(generateAdjustmentCase(tenantId, pId, seq));
      const adjId = reasonableAdjustmentId(tenantId, seq);
      srsAdjRows.push({
        versionId:          adjId,
        id:                 adjId,
        tenantId,
        enrolmentId:        enrollId,
        personId:           pId,
        adjustmentTypeCode: 'extra-time',
        scopeCode:          'exam',
        notes:              'DEMO - 25% additional time. Synthetic record.',
        actorId:            ACTOR,
        validFrom:          VALID_FROM,
        recordedAt:         VALID_FROM,
      });
    }
    if (isBob || hasEcClaim(seq)) {
      ecClaimRows.push(generateEcClaim(tenantId, pId, enrollId, seq));
    }
    if (hasMentalHealthCase(seq)) {
      mentalHealthRows.push(generateMentalHealthCase(tenantId, pId, seq));
    }
  }

  await batchInsert(db, reasonableAdjustments, srsAdjRows);
  if (wellbeingCaseRows.length > 0)  await batchInsert(db, wellbeingCasesTable,         wellbeingCaseRows);
  if (disabilityRows.length > 0)      await batchInsert(db, disabilitySupportCasesTable, disabilityRows);
  if (adjustmentCaseRows.length > 0) await batchInsert(db, adjustmentCasesTable,        adjustmentCaseRows);
  if (mentalHealthRows.length > 0)    await batchInsert(db, mentalHealthCasesTable,       mentalHealthRows);
  if (ecClaimRows.length > 0)         await batchInsert(db, ecClaimsTable,               ecClaimRows);
}

// ─── Phase: integration ───────────────────────────────────────────────────────

async function loadIntegration(db: Db, tenantId: string): Promise<void> {
  const vleContractId = await lookupVleContractId(db);
  if (!vleContractId) {
    console.warn('[demo-data] VLE integration contract not found — skipping integration phase');
    return;
  }
  await batchInsert(db, integrationRegistrations, [buildVleRegistration(tenantId, vleContractId)]);

  const vleRegId      = vleRegistrationId(tenantId);
  const offerings     = getModuleOfferingsForYear(tenantId, ACADEMIC_YEAR);
  const componentMap  = new Map<string, [string, string]>();
  for (const o of offerings) {
    componentMap.set(o.offeringId, [
      assessmentComponentId(tenantId, o.offeringId, 'coursework'),
      assessmentComponentId(tenantId, o.offeringId, 'exam'),
    ]);
  }

  const exchanges: typeof integrationExchanges.$inferInsert[] = [];
  for (let seq = 1; seq <= TOTAL_STUDENTS; seq++) {
    if (statusCodeForSeq(seq) !== 'enrolled') continue;
    const enrollId = enrolmentId(tenantId, seq);
    const slots    = generateRegistrationsForStudent(
      tenantId, seq, enrollId, ACADEMIC_YEAR, slotOverridesForSeq(seq),
    );
    for (const s of slots) {
      const regStatus = s.registration.statusCode;
      if (regStatus !== 'registered' && regStatus !== 'override') continue;
      const compIds = componentMap.get(s.registration.moduleOfferingId);
      if (!compIds) continue;
      for (const compId of compIds) {
        exchanges.push(buildVleExchange(tenantId, vleRegId, s.registration.id, compId, seq, MARK_DATE));
      }
    }
  }
  await batchInsert(db, integrationExchanges, exchanges);
}

// ─── Phase: boards ────────────────────────────────────────────────────────────

async function loadBoards(db: Db, tenantId: string): Promise<void> {
  const autumnBoardId = examBoardIdForPeriod(tenantId, ACADEMIC_YEAR, 'AUTUMN');
  const springBoardId = examBoardIdForPeriod(tenantId, ACADEMIC_YEAR, 'SPRING');
  const awardBId      = awardBoardId(tenantId, ACADEMIC_YEAR);

  // Ratify autumn + spring module boards; leave summer pending; ratify award board
  await db.update(examBoards)
    .set({ ratifiedAt: AUTUMN_RATIFIED_AT, quorumCount: 4, quorumRecordedAt: AUTUMN_RATIFIED_AT })
    .where(eq(examBoards.id, autumnBoardId));

  await db.update(examBoards)
    .set({ ratifiedAt: SPRING_RATIFIED_AT, quorumCount: 4, quorumRecordedAt: SPRING_RATIFIED_AT })
    .where(eq(examBoards.id, springBoardId));

  await db.update(examBoards)
    .set({ ratifiedAt: AWARD_RATIFIED_AT, quorumCount: 5, quorumRecordedAt: AWARD_RATIFIED_AT })
    .where(eq(examBoards.id, awardBId));

  // Count candidates per board using the same slot-override logic as loadRegistrations
  let autumnCandidates = 0;
  let springCandidates = 0;
  for (let seq = 1; seq <= TOTAL_STUDENTS; seq++) {
    if (statusCodeForSeq(seq) !== 'enrolled') continue;
    const enrollId = enrolmentId(tenantId, seq);
    const slots    = generateRegistrationsForStudent(
      tenantId, seq, enrollId, ACADEMIC_YEAR, slotOverridesForSeq(seq),
    );
    for (const s of slots) {
      const regStatus = s.registration.statusCode;
      if (regStatus !== 'registered' && regStatus !== 'override') continue;
      if (s.termCode === 'AUTUMN') autumnCandidates++;
      if (s.termCode === 'SPRING') springCandidates++;
    }
  }
  const graduatedCount = Array.from({ length: TOTAL_STUDENTS }, (_, i) => i + 1)
    .filter(s => statusCodeForSeq(s) === 'graduated').length;

  // Data packs (autumn, spring, award)
  const dataPacks = [
    generateDataPack(tenantId, autumnBoardId, autumnCandidates, AUTUMN_RATIFIED_AT),
    generateDataPack(tenantId, springBoardId, springCandidates, SPRING_RATIFIED_AT),
    generateDataPack(tenantId, awardBId,      graduatedCount,   AWARD_RATIFIED_AT),
  ];
  await batchInsert(db, examBoardDataPacks, dataPacks);

  const autumnPackId = dataPacks[0]!.id!;
  const springPackId = dataPacks[1]!.id!;
  const awardPackId  = dataPacks[2]!.id!;

  // Candidate profiles
  const profiles: typeof examBoardCandidateProfiles.$inferInsert[] = [];

  for (let seq = 1; seq <= TOTAL_STUDENTS; seq++) {
    const status = statusCodeForSeq(seq);
    const pId    = mkPersonId(tenantId, seq);
    const eId    = enrolmentId(tenantId, seq);

    if (status === 'enrolled') {
      const slots = generateRegistrationsForStudent(
        tenantId, seq, eId, ACADEMIC_YEAR, slotOverridesForSeq(seq),
      );
      const baseProfile = {
        academicYear:                 ACADEMIC_YEAR,
        yearOfStudy:                  yearOfStudyForSeq(seq),
        classificationRecommendation: classificationCode(seq),
        flags: {
          adjustmentApplied:  seq === 3 || hasWellbeingCase(seq),
          ecClaimOnRecord:    seq === 2 || hasEcClaim(seq),
          misconductOnRecord: false,
        },
      };
      for (const s of slots) {
        const regStatus = s.registration.statusCode;
        if (regStatus !== 'registered' && regStatus !== 'override') continue;
        const packId = s.termCode === 'AUTUMN' ? autumnPackId : springPackId;
        profiles.push(generateCandidateProfile(tenantId, packId, eId, pId, {
          ...baseProfile, term: s.termCode,
        }));
      }
    } else if (status === 'graduated') {
      const prog = BASELINE_PROGRAMMES[seq % BASELINE_PROGRAMMES.length]!;
      profiles.push(generateCandidateProfile(tenantId, awardPackId, eId, pId, {
        academicYear:       ACADEMIC_YEAR,
        qualificationCode:  qualCodeForProgramme(prog.code),
        classificationCode: classificationCode(seq),
        flags:              { adjustmentApplied: false, ecClaimOnRecord: false, misconductOnRecord: false },
      }));
    }
  }
  await batchInsert(db, examBoardCandidateProfiles, profiles);

  // Member attendance — chair + 2 members per ratified board (9 rows total)
  const attendances: typeof examBoardMemberAttendance.$inferInsert[] = [];
  for (const [boardId, attendedAt] of [
    [autumnBoardId, AUTUMN_RATIFIED_AT],
    [springBoardId, SPRING_RATIFIED_AT],
    [awardBId,      AWARD_RATIFIED_AT],
  ] as [string, Date][]) {
    attendances.push(
      generateMemberAttendance(tenantId, boardId, 'chair',  `demo-chair-${boardId}`,   attendedAt),
      generateMemberAttendance(tenantId, boardId, 'member', `demo-member1-${boardId}`, attendedAt),
      generateMemberAttendance(tenantId, boardId, 'member', `demo-member2-${boardId}`, attendedAt),
    );
  }
  await batchInsert(db, examBoardMemberAttendance, attendances);

  // External examiner sign-offs — one per ratified board (3 rows)
  const signoffs: typeof externalExaminerSignoffs.$inferInsert[] = [];
  for (const [boardId, signedAt] of [
    [autumnBoardId, AUTUMN_RATIFIED_AT],
    [springBoardId, SPRING_RATIFIED_AT],
    [awardBId,      AWARD_RATIFIED_AT],
  ] as [string, Date][]) {
    signoffs.push(
      generateExternalExaminerSignoff(tenantId, boardId, `demo-ext-examiner-${boardId}`, signedAt),
    );
  }
  await batchInsert(db, externalExaminerSignoffs, signoffs);
}

// ─── Phase: progression ───────────────────────────────────────────────────────

async function loadProgression(db: Db, tenantId: string): Promise<void> {
  const springBoardId = examBoardIdForPeriod(tenantId, ACADEMIC_YEAR, 'SPRING');
  const awardBId      = awardBoardId(tenantId, ACADEMIC_YEAR);

  const progressionRows: typeof progressionDecisions.$inferInsert[] = [];
  const awardRows:       typeof awards.$inferInsert[]               = [];

  for (let seq = 1; seq <= TOTAL_STUDENTS; seq++) {
    const status = statusCodeForSeq(seq);
    const eId    = enrolmentId(tenantId, seq);

    if (status === 'enrolled') {
      progressionRows.push(generateProgressionDecision(
        tenantId,
        eId,
        ACADEMIC_YEAR,
        yearOfStudyForSeq(seq),
        progressionDecisionCode(seq),
        springBoardId,
        SPRING_RATIFIED_AT,
      ));
    } else if (status === 'graduated') {
      const pId  = mkPersonId(tenantId, seq);
      const prog = BASELINE_PROGRAMMES[seq % BASELINE_PROGRAMMES.length]!;
      awardRows.push(generateAward(
        tenantId,
        eId,
        pId,
        awardBId,
        qualCodeForProgramme(prog.code),
        classificationCode(seq),
        '2026-07-15',
        AWARD_RATIFIED_AT,
      ));
    }
  }

  await batchInsert(db, progressionDecisions, progressionRows);
  await batchInsert(db, awards,               awardRows);
}

// ─── Phase: corrections ───────────────────────────────────────────────────────

async function loadCorrections(db: Db, tenantId: string): Promise<void> {
  const correctionDate = new Date('2026-07-20T09:00:00Z');

  const cases: typeof postRatificationCases.$inferInsert[] = [
    generatePostRatificationCase(
      tenantId, enrolmentId(tenantId, 101), 101,
      'administrative-correction', 'upheld', correctionDate,
    ),
    generatePostRatificationCase(
      tenantId, enrolmentId(tenantId, 201), 201,
      'appeal', 'under-review', correctionDate,
    ),
    generatePostRatificationCase(
      tenantId, enrolmentId(tenantId, 301), 301,
      'appeal', 'dismissed', correctionDate,
    ),
  ];
  await batchInsert(db, postRatificationCases, cases);

  // Amendment for the upheld administrative correction (seq 101)
  const caseLogicId   = postRatificationCaseLogicalId(tenantId, 101);
  const autumnMod     = AUTUMN_MODULES[101 % AUTUMN_MODULES.length]!;
  const offeringId    = moduleOfferingId(tenantId, autumnMod.code, ACADEMIC_YEAR, 'AUTUMN');
  const cwCompId      = assessmentComponentId(tenantId, offeringId, 'coursework');
  const correctedRegId = moduleRegistrationId(tenantId, 101, 0);
  const correctedMarkId = markLogicalId(tenantId, correctedRegId, cwCompId);

  await batchInsert(db, postRatificationAmendments, [
    generatePostRatificationAmendment(
      tenantId,
      caseLogicId,
      'mark',
      correctedMarkId,
      { rawMark: '35', adjustedMark: '35', locked: true },
      { rawMark: '35', adjustedMark: '37', locked: true },
      correctionDate,
    ),
  ]);
}
