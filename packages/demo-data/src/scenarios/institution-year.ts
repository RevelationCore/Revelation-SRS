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
  hesaStudentReturns,
  hesaStudentReturnRecords,
  ucasApplications,
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
  examBoardIdForPeriod,
  markLogicalId,
  moduleOfferingId,
  moduleRegistrationId,
  personId as mkPersonId,
  postRatificationCaseLogicalId,
  programmeId as mkProgrammeId,
  vleRegistrationId,
  // Decision helpers
  classificationCode,
  progressionDecisionCode,
  qualCodeForProgramme,
  // Generators
  buildVleExchange,
  buildVleRegistration,
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
  rawMarkForSlot,
  ucasPersonalId,
  wellbeingSchemaExists,
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
import { deterministicId } from '../generators/ids.js';
import { STORY_MARKERS } from '../story-markers.js';
import type { ScenarioManifest } from '../types.js';
import { batchInsert } from '../utils/batch.js';

export const manifest: ScenarioManifest = {
  slug:             'institution-year',
  name:             'S6 — Full-Institution Year',
  schemaVersion:    '0023',
  referenceDate:    '2026-07-31',
  academicYears:    ['2022-23', '2023-24', '2024-25', '2025-26'],
  targetVolumes:    {
    students:              50_000,
    enrolments:            50_000,
    examBoards:               16, // 4 years × 4 boards each
    progressionDecisions:  38_000,
    awards:                10_000,
  },
  loadTimeBudgetMs: 1_800_000,
  storyMarkers:     [
    STORY_MARKERS.S6_ALEX_STANDARD,
    STORY_MARKERS.S6_BEN_INTERCALATED,
    STORY_MARKERS.S6_CARA_INTERNATIONAL,
    STORY_MARKERS.S6_DAN_WELLBEING,
    STORY_MARKERS.S6_EVA_RESIT,
    STORY_MARKERS.S6_FIN_GRADUATED,
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
    'regulatory',
    'corrections',
  ],
};

// ─── Constants ────────────────────────────────────────────────────────────────

const TOTAL_STUDENTS = 50_000;
const ACADEMIC_YEARS = ['2022-23', '2023-24', '2024-25', '2025-26'] as const;
const CURRENT_YEAR  = '2025-26';
const VALID_FROM    = new Date('2022-09-01T00:00:00Z');
const MARK_DATE     = new Date('2026-01-30T00:00:00Z');
const ACTOR         = 'demo-data:institution-year';

// Ratification timestamps per academic year
const RATIFIED_AT: Record<string, { autumn: Date; spring: Date; award: Date }> = {
  '2022-23': {
    autumn: new Date('2023-02-15T10:00:00Z'),
    spring: new Date('2023-06-10T10:00:00Z'),
    award:  new Date('2023-07-15T10:00:00Z'),
  },
  '2023-24': {
    autumn: new Date('2024-02-15T10:00:00Z'),
    spring: new Date('2024-06-10T10:00:00Z'),
    award:  new Date('2024-07-15T10:00:00Z'),
  },
  '2024-25': {
    autumn: new Date('2025-02-15T10:00:00Z'),
    spring: new Date('2025-06-10T10:00:00Z'),
    award:  new Date('2025-07-15T10:00:00Z'),
  },
  '2025-26': {
    autumn: new Date('2026-02-15T10:00:00Z'),
    spring: new Date('2026-06-10T10:00:00Z'),
    award:  new Date('2026-07-15T10:00:00Z'),
  },
};

// ─── Per-student helpers ───────────────────────────────────────────────────────

// The academic year in which this student's registrations/marks/boards live.
// For most students this equals their year of entry. For ben (seq 2), who
// intercalated in 2023-24 and returned, it is the current year.
function registrationYearForSeq(seq: number): string {
  if (seq === 2) return CURRENT_YEAR; // ben: back in year 3 after intercalation
  return academicYearOfEntryForSeq(seq);
}

function academicYearOfEntryForSeq(seq: number): string {
  // Story marker overrides
  if (seq === 1) return '2025-26'; // alex: year 1 new entrant
  if (seq === 2) return '2022-23'; // ben: entered 3 years ago
  if (seq === 3) return '2025-26'; // cara: international, year 1
  if (seq === 4) return '2024-25'; // dan: year 2 wellbeing
  if (seq === 5) return '2023-24'; // eva: year 3 resit
  if (seq === 6) return '2022-23'; // fin: graduated with distinction
  // Band rotation for seqs 7+: 4 equal cohorts
  return ACADEMIC_YEARS[(seq - 7) % 4]!;
}

function statusCodeForSeq(seq: number): 'enrolled' | 'intermitting' | 'withdrawn' | 'graduated' {
  // Story markers
  if (seq === 2) return 'enrolled';   // ben: still enrolled (returned from intercalation)
  if (seq === 6) return 'graduated';  // fin: graduated with distinction

  const entryYear = academicYearOfEntryForSeq(seq);
  switch (entryYear) {
    case '2022-23':
      // 3-year degrees completed: ~80% graduated, ~20% withdrawn
      return (seq % 5 === 0) ? 'withdrawn' : 'graduated';
    case '2023-24':
      // Year 3 in 2025-26: mostly enrolled, some withdrawn
      return (seq % 8 === 0) ? 'withdrawn' : 'enrolled';
    case '2024-25':
      // Year 2: mostly enrolled, some intermitting/withdrawn
      if (seq % 25 === 0) return 'intermitting';
      return (seq % 12 === 0) ? 'withdrawn' : 'enrolled';
    case '2025-26':
      // New entrants: mostly enrolled, small withdrawal rate
      if (seq % 30 === 0) return 'intermitting';
      return (seq % 15 === 0) ? 'withdrawn' : 'enrolled';
    default:
      return 'enrolled';
  }
}

function modeOfStudyForSeq(seq: number): string {
  const r = seq % 20;
  if (r <= 15) return 'full-time';
  if (r === 16) return 'part-time';
  if (r === 17) return 'distance';
  if (r === 18) return 'sandwich';
  return 'full-time';
}

function isInternationalForSeq(seq: number): boolean {
  if (seq === 3) return true; // cara is international
  return seq % 20 === 0;
}

function enrolmentId(tenantId: string, seq: number): string {
  return deterministicId('s6-enrolment', tenantId, String(seq));
}

function adjustmentId(tenantId: string, seq: number): string {
  return deterministicId('s6-adjustment', tenantId, String(seq));
}

function hesaReturnId(tenantId: string, academicYear: string): string {
  return deterministicId('s6-hesa-return', tenantId, academicYear);
}

// Story-marker slot overrides (same philosophy as S4/S5)
function slotOverridesForSeq(seq: number): { slot0Status?: string; slot1Status?: string } | undefined {
  if (seq === 1) return {};
  if (seq === 5) return { slot1Status: 'registered' }; // eva gets a resit marker
  if (seq === 4) return { slot0Status: 'override' };   // dan has adjustment/override
  return undefined;
}

// ─── Load function ─────────────────────────────────────────────────────────────

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
    case 'regulatory':     return loadRegulatory(db, tenantId);
    case 'corrections':    return loadCorrections(db, tenantId);
    default:               return;
  }
}

// ─── Phase: reference-data ────────────────────────────────────────────────────

async function loadReferenceData(db: Db, tenantId: string): Promise<void> {
  const calendar   = generateMultiYearCalendar(tenantId, [...manifest.academicYears]);
  const curriculum = generateCurriculum(tenantId, [...manifest.academicYears]);
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
// Process in chunks of 5,000 to keep peak memory manageable.

const CHUNK = 5_000;

async function loadPersons(db: Db, tenantId: string): Promise<void> {
  for (let base = 1; base <= TOTAL_STUDENTS; base += CHUNK) {
    const end     = Math.min(base + CHUNK - 1, TOTAL_STUDENTS);
    const bundles = [];
    for (let seq = base; seq <= end; seq++) {
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
}

// ─── Phase: enrolments ────────────────────────────────────────────────────────

async function loadEnrolments(db: Db, tenantId: string): Promise<void> {
  for (let base = 1; base <= TOTAL_STUDENTS; base += CHUNK) {
    const end  = Math.min(base + CHUNK - 1, TOTAL_STUDENTS);
    const rows = [];
    for (let seq = base; seq <= end; seq++) {
      const status    = statusCodeForSeq(seq);
      const entryYear = academicYearOfEntryForSeq(seq);
      const startYear = parseInt(entryYear.split('-')[0]!, 10);
      const pCode     = BASELINE_PROGRAMMES[seq % BASELINE_PROGRAMMES.length]!.code;
      rows.push({
        id:                  enrolmentId(tenantId, seq),
        tenantId,
        personId:            mkPersonId(tenantId, seq),
        programmeId:         mkProgrammeId(tenantId, pCode),
        statusCode:          status,
        modeOfStudyCode:     modeOfStudyForSeq(seq),
        academicYearOfEntry: entryYear,
        startDate:           `${startYear}-09-23`,
        feeBandCode:         isInternationalForSeq(seq) ? 'overseas' : 'home',
        fundingSourceCode:   isInternationalForSeq(seq) ? 'self-funded' : 'slc',
        ucasPersonalId:      isInternationalForSeq(seq) ? null : ucasPersonalId(seq),
        validFrom:           VALID_FROM,
        recordedAt:          VALID_FROM,
      });
    }
    await batchInsert(db, enrolments, rows);
  }
}

// ─── Phase: registrations ─────────────────────────────────────────────────────
// Each student generates registrations for their registrationYear. Process
// per-academic-year so board inserts are keyed to the correct year.

async function loadRegistrations(db: Db, tenantId: string): Promise<void> {
  for (const academicYear of ACADEMIC_YEARS) {
    const moduleBoards = generateExamBoards(tenantId, academicYear);
    const awardBoard   = generateAwardBoard(tenantId, academicYear);
    await batchInsert(db, examBoards, [...moduleBoards, awardBoard]);

    const allRegistrations: typeof moduleRegistrations.$inferInsert[] = [];
    const allExamEntries:   typeof examEntries.$inferInsert[]          = [];

    for (let seq = 1; seq <= TOTAL_STUDENTS; seq++) {
      if (registrationYearForSeq(seq) !== academicYear) continue;
      const status = statusCodeForSeq(seq);
      // Generate registrations for enrolled students (and graduated students who
      // had registrations in this year — their historical records)
      if (status !== 'enrolled' && status !== 'graduated') continue;

      const eId   = enrolmentId(tenantId, seq);
      const slots = generateRegistrationsForStudent(
        tenantId, seq, eId, academicYear, slotOverridesForSeq(seq),
      );
      for (const s of slots) {
        allRegistrations.push(s.registration);
        const regStatus = s.registration.statusCode;
        if (regStatus === 'registered' || regStatus === 'override') {
          const boardId = examBoardIdForPeriod(tenantId, academicYear, s.termCode);
          allExamEntries.push(generateExamEntry(tenantId, seq, s, boardId));
        }
      }
    }

    await batchInsert(db, moduleRegistrations, allRegistrations);
    await batchInsert(db, examEntries,         allExamEntries);
  }
}

// ─── Phase: assessment ────────────────────────────────────────────────────────
// All marks are locked=true (reference date 2026-07-31 is post-ratification
// for every year including 2025-26).

async function loadAssessment(db: Db, tenantId: string): Promise<void> {
  for (const academicYear of ACADEMIC_YEARS) {
    const offerings      = getModuleOfferingsForYear(tenantId, academicYear);
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
      if (registrationYearForSeq(seq) !== academicYear) continue;
      const status = statusCodeForSeq(seq);
      if (status !== 'enrolled' && status !== 'graduated') continue;

      const eId   = enrolmentId(tenantId, seq);
      const slots = generateRegistrationsForStudent(
        tenantId, seq, eId, academicYear, slotOverridesForSeq(seq),
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

      if (allMarks.length >= 2_000) {
        await batchInsert(db, marks,         allMarks.splice(0));
        await batchInsert(db, moduleResults, allResults.splice(0));
      }
    }

    if (allMarks.length > 0)   await batchInsert(db, marks,         allMarks);
    if (allResults.length > 0) await batchInsert(db, moduleResults, allResults);
  }
}

// ─── Phase: wellbeing ─────────────────────────────────────────────────────────

async function loadWellbeing(db: Db, tenantId: string): Promise<void> {
  const schemaOk = await wellbeingSchemaExists(db);
  if (!schemaOk) {
    console.warn('[demo-data] wellbeing schema not found — skipping wellbeing phase');
    return;
  }

  const wellbeingCaseRows:   typeof wellbeingCasesTable.$inferInsert[]         = [];
  const disabilityRows:       typeof disabilitySupportCasesTable.$inferInsert[] = [];
  const adjustmentCaseRows:  typeof adjustmentCasesTable.$inferInsert[]        = [];
  const mentalHealthRows:     typeof mentalHealthCasesTable.$inferInsert[]      = [];
  const ecClaimRows:          typeof ecClaimsTable.$inferInsert[]               = [];
  const srsAdjRows:           typeof reasonableAdjustments.$inferInsert[]       = [];

  for (let seq = 1; seq <= TOTAL_STUDENTS; seq++) {
    const status = statusCodeForSeq(seq);
    if (status !== 'enrolled') continue;

    const isDan = seq === 4; // dan is the wellbeing archetype
    const isEva = seq === 5; // eva has an EC claim
    if (!hasWellbeingCase(seq) && !isDan && !isEva) continue;

    const pId    = mkPersonId(tenantId, seq);
    const eId    = enrolmentId(tenantId, seq);

    wellbeingCaseRows.push(generateWellbeingCase(tenantId, pId, seq));

    if (!isEva) {
      disabilityRows.push(generateDisabilitySupportCase(tenantId, pId, seq));
      adjustmentCaseRows.push(generateAdjustmentCase(tenantId, pId, seq));
      const adjId = adjustmentId(tenantId, seq);
      srsAdjRows.push({
        versionId:          adjId,
        id:                 adjId,
        tenantId,
        enrolmentId:        eId,
        personId:           pId,
        adjustmentTypeCode: 'extra-time',
        scopeCode:          'exam',
        notes:              'DEMO - 25% additional time. Synthetic record.',
        actorId:            ACTOR,
        validFrom:          VALID_FROM,
        recordedAt:         VALID_FROM,
      });
    }
    if (isEva || hasEcClaim(seq)) {
      ecClaimRows.push(generateEcClaim(tenantId, pId, eId, seq));
    }
    if (hasMentalHealthCase(seq)) {
      mentalHealthRows.push(generateMentalHealthCase(tenantId, pId, seq));
    }

    // Flush periodically to avoid large in-memory accumulation
    if (wellbeingCaseRows.length >= 500) {
      await batchInsert(db, reasonableAdjustments,       srsAdjRows.splice(0));
      await batchInsert(db, wellbeingCasesTable,         wellbeingCaseRows.splice(0));
      await batchInsert(db, disabilitySupportCasesTable, disabilityRows.splice(0));
      await batchInsert(db, adjustmentCasesTable,        adjustmentCaseRows.splice(0));
      await batchInsert(db, mentalHealthCasesTable,      mentalHealthRows.splice(0));
      await batchInsert(db, ecClaimsTable,               ecClaimRows.splice(0));
    }
  }

  if (srsAdjRows.length > 0)           await batchInsert(db, reasonableAdjustments,       srsAdjRows);
  if (wellbeingCaseRows.length > 0)    await batchInsert(db, wellbeingCasesTable,         wellbeingCaseRows);
  if (disabilityRows.length > 0)        await batchInsert(db, disabilitySupportCasesTable, disabilityRows);
  if (adjustmentCaseRows.length > 0)   await batchInsert(db, adjustmentCasesTable,        adjustmentCaseRows);
  if (mentalHealthRows.length > 0)      await batchInsert(db, mentalHealthCasesTable,       mentalHealthRows);
  if (ecClaimRows.length > 0)           await batchInsert(db, ecClaimsTable,               ecClaimRows);
}

// ─── Phase: integration ───────────────────────────────────────────────────────
// VLE data only for the current academic year (2025-26).

async function loadIntegration(db: Db, tenantId: string): Promise<void> {
  const vleContractId = await lookupVleContractId(db);
  if (!vleContractId) {
    console.warn('[demo-data] VLE integration contract not found — skipping integration phase');
    return;
  }
  await batchInsert(db, integrationRegistrations, [buildVleRegistration(tenantId, vleContractId)]);

  const vleRegId     = vleRegistrationId(tenantId);
  const offerings    = getModuleOfferingsForYear(tenantId, CURRENT_YEAR);
  const componentMap = new Map<string, [string, string]>();
  for (const o of offerings) {
    componentMap.set(o.offeringId, [
      assessmentComponentId(tenantId, o.offeringId, 'coursework'),
      assessmentComponentId(tenantId, o.offeringId, 'exam'),
    ]);
  }

  const exchanges: typeof integrationExchanges.$inferInsert[] = [];
  for (let seq = 1; seq <= TOTAL_STUDENTS; seq++) {
    if (registrationYearForSeq(seq) !== CURRENT_YEAR) continue;
    const status = statusCodeForSeq(seq);
    if (status !== 'enrolled' && status !== 'graduated') continue;

    const eId   = enrolmentId(tenantId, seq);
    const slots = generateRegistrationsForStudent(
      tenantId, seq, eId, CURRENT_YEAR, slotOverridesForSeq(seq),
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

    if (exchanges.length >= 2_000) {
      await batchInsert(db, integrationExchanges, exchanges.splice(0));
    }
  }
  if (exchanges.length > 0) await batchInsert(db, integrationExchanges, exchanges);
}

// ─── Phase: boards ────────────────────────────────────────────────────────────
// Ratify all boards. Generate data packs, candidate profiles, attendance, and
// external examiner sign-offs for each year.

async function loadBoards(db: Db, tenantId: string): Promise<void> {
  for (const academicYear of ACADEMIC_YEARS) {
    const ts = RATIFIED_AT[academicYear]!;

    // Ratify autumn + spring boards for every year (all are past by reference date)
    const autumnBoardId = examBoardIdForPeriod(tenantId, academicYear, 'AUTUMN');
    const springBoardId = examBoardIdForPeriod(tenantId, academicYear, 'SPRING');
    const awardBId      = awardBoardId(tenantId, academicYear);

    await db.update(examBoards)
      .set({ ratifiedAt: ts.autumn, quorumCount: 4, quorumRecordedAt: ts.autumn })
      .where(eq(examBoards.id, autumnBoardId));

    await db.update(examBoards)
      .set({ ratifiedAt: ts.spring, quorumCount: 4, quorumRecordedAt: ts.spring })
      .where(eq(examBoards.id, springBoardId));

    // Summer board: ratified for prior years, left pending for 2025-26
    if (academicYear !== CURRENT_YEAR) {
      const summerBoardId = examBoardIdForPeriod(tenantId, academicYear, 'SUMMER');
      await db.update(examBoards)
        .set({ ratifiedAt: ts.spring, quorumCount: 4, quorumRecordedAt: ts.spring })
        .where(eq(examBoards.id, summerBoardId));
    }

    await db.update(examBoards)
      .set({ ratifiedAt: ts.award, quorumCount: 5, quorumRecordedAt: ts.award })
      .where(eq(examBoards.id, awardBId));

    // Count candidates per board for data pack sizes
    let autumnCandidates = 0;
    let springCandidates = 0;
    for (let seq = 1; seq <= TOTAL_STUDENTS; seq++) {
      if (registrationYearForSeq(seq) !== academicYear) continue;
      const status = statusCodeForSeq(seq);
      if (status !== 'enrolled' && status !== 'graduated') continue;

      const eId   = enrolmentId(tenantId, seq);
      const slots = generateRegistrationsForStudent(
        tenantId, seq, eId, academicYear, slotOverridesForSeq(seq),
      );
      for (const s of slots) {
        const regStatus = s.registration.statusCode;
        if (regStatus !== 'registered' && regStatus !== 'override') continue;
        if (s.termCode === 'AUTUMN') autumnCandidates++;
        if (s.termCode === 'SPRING') springCandidates++;
      }
    }
    const graduatedCount = Array.from({ length: TOTAL_STUDENTS }, (_, i) => i + 1)
      .filter(s => academicYearOfEntryForSeq(s) === academicYear && statusCodeForSeq(s) === 'graduated')
      .length;

    const dataPacks = [
      generateDataPack(tenantId, autumnBoardId, autumnCandidates, ts.autumn),
      generateDataPack(tenantId, springBoardId, springCandidates, ts.spring),
      generateDataPack(tenantId, awardBId,      graduatedCount,   ts.award),
    ];
    await batchInsert(db, examBoardDataPacks, dataPacks);

    const autumnPackId = dataPacks[0]!.id!;
    const springPackId = dataPacks[1]!.id!;
    const awardPackId  = dataPacks[2]!.id!;

    // Candidate profiles — current-year enrolled + graduated students of this cohort
    const profiles: typeof examBoardCandidateProfiles.$inferInsert[] = [];
    for (let seq = 1; seq <= TOTAL_STUDENTS; seq++) {
      if (registrationYearForSeq(seq) !== academicYear) continue;
      const status = statusCodeForSeq(seq);
      const pId    = mkPersonId(tenantId, seq);
      const eId    = enrolmentId(tenantId, seq);

      if (status === 'enrolled') {
        const entryYear = academicYearOfEntryForSeq(seq);
        const entryInt  = parseInt(entryYear.split('-')[0]!, 10);
        const regInt    = parseInt(academicYear.split('-')[0]!, 10);
        const yearOfStudy = String(regInt - entryInt + 1);

        const slots = generateRegistrationsForStudent(
          tenantId, seq, eId, academicYear, slotOverridesForSeq(seq),
        );
        const baseProfile = {
          academicYear,
          yearOfStudy,
          classificationRecommendation: classificationCode(seq),
          flags: {
            adjustmentApplied:  seq === 4 || hasWellbeingCase(seq),
            ecClaimOnRecord:    seq === 5 || hasEcClaim(seq),
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
      } else if (status === 'graduated' && academicYearOfEntryForSeq(seq) === academicYear) {
        const prog = BASELINE_PROGRAMMES[seq % BASELINE_PROGRAMMES.length]!;
        profiles.push(generateCandidateProfile(tenantId, awardPackId, eId, pId, {
          academicYear,
          qualificationCode:  qualCodeForProgramme(prog.code),
          classificationCode: seq === 6 ? 'first' : classificationCode(seq),
          flags:              { adjustmentApplied: false, ecClaimOnRecord: false, misconductOnRecord: false },
        }));
      }

      if (profiles.length >= 2_000) {
        await batchInsert(db, examBoardCandidateProfiles, profiles.splice(0));
      }
    }
    if (profiles.length > 0) await batchInsert(db, examBoardCandidateProfiles, profiles);

    // Member attendance — chair + 2 members for each ratified board
    const attendances: typeof examBoardMemberAttendance.$inferInsert[] = [];
    for (const [boardId, attendedAt] of [
      [autumnBoardId, ts.autumn],
      [springBoardId, ts.spring],
      [awardBId,      ts.award],
    ] as [string, Date][]) {
      attendances.push(
        generateMemberAttendance(tenantId, boardId, 'chair',  `demo-chair-${boardId}`,   attendedAt),
        generateMemberAttendance(tenantId, boardId, 'member', `demo-member1-${boardId}`, attendedAt),
        generateMemberAttendance(tenantId, boardId, 'member', `demo-member2-${boardId}`, attendedAt),
      );
    }
    await batchInsert(db, examBoardMemberAttendance, attendances);

    // External examiner sign-offs — one per ratified board
    const signoffs: typeof externalExaminerSignoffs.$inferInsert[] = [];
    for (const [boardId, signedAt] of [
      [autumnBoardId, ts.autumn],
      [springBoardId, ts.spring],
      [awardBId,      ts.award],
    ] as [string, Date][]) {
      signoffs.push(
        generateExternalExaminerSignoff(tenantId, boardId, `demo-ext-examiner-${boardId}`, signedAt),
      );
    }
    await batchInsert(db, externalExaminerSignoffs, signoffs);
  }
}

// ─── Phase: progression ───────────────────────────────────────────────────────

async function loadProgression(db: Db, tenantId: string): Promise<void> {
  for (const academicYear of ACADEMIC_YEARS) {
    const ts            = RATIFIED_AT[academicYear]!;
    const springBoardId = examBoardIdForPeriod(tenantId, academicYear, 'SPRING');
    const awardBId      = awardBoardId(tenantId, academicYear);

    const progressionRows: typeof progressionDecisions.$inferInsert[] = [];
    const awardRows:       typeof awards.$inferInsert[]               = [];

    for (let seq = 1; seq <= TOTAL_STUDENTS; seq++) {
      if (registrationYearForSeq(seq) !== academicYear) continue;
      const status = statusCodeForSeq(seq);
      const eId    = enrolmentId(tenantId, seq);

      if (status === 'enrolled') {
        const entryYear    = academicYearOfEntryForSeq(seq);
        const entryInt     = parseInt(entryYear.split('-')[0]!, 10);
        const regInt       = parseInt(academicYear.split('-')[0]!, 10);
        const yearOfStudy  = String(regInt - entryInt + 1);
        const decisionCode = seq === 5 ? 'resit' : progressionDecisionCode(seq);

        progressionRows.push(generateProgressionDecision(
          tenantId, eId, academicYear, yearOfStudy, decisionCode, springBoardId, ts.spring,
        ));
      } else if (status === 'graduated' && academicYearOfEntryForSeq(seq) === academicYear) {
        const pId  = mkPersonId(tenantId, seq);
        const prog = BASELINE_PROGRAMMES[seq % BASELINE_PROGRAMMES.length]!;
        awardRows.push(generateAward(
          tenantId,
          eId,
          pId,
          awardBId,
          qualCodeForProgramme(prog.code),
          seq === 6 ? 'first' : classificationCode(seq),
          `${parseInt(academicYear.split('-')[0]!, 10) + 1}-07-15`,
          ts.award,
        ));
      }

      if (progressionRows.length >= 2_000) {
        await batchInsert(db, progressionDecisions, progressionRows.splice(0));
      }
      if (awardRows.length >= 2_000) {
        await batchInsert(db, awards, awardRows.splice(0));
      }
    }

    if (progressionRows.length > 0) await batchInsert(db, progressionDecisions, progressionRows);
    if (awardRows.length > 0)        await batchInsert(db, awards,               awardRows);
  }
}

// ─── Phase: regulatory ────────────────────────────────────────────────────────
// HESA student return history: 3 submitted returns for prior years,
// 1 draft return for the current year.

// Seqs belonging to each submitted year (exclude CURRENT_YEAR).
// For seqs ≥ 7 the year cycles: (seq-7)%4 → 0='2022-23', 1='2023-24', 2='2024-25', 3='2025-26'.
const HESA_YEAR_SEQS: Record<string, number[]> = {
  '2022-23': [2, 6,  ...Array.from({ length: 250 }, (_, i) => 7  + i * 4)],
  '2023-24': [5,     ...Array.from({ length: 250 }, (_, i) => 8  + i * 4)],
  '2024-25': [4,     ...Array.from({ length: 250 }, (_, i) => 9  + i * 4)],
};

async function loadRegulatory(db: Db, tenantId: string): Promise<void> {
  const returnRows: typeof hesaStudentReturns.$inferInsert[] = [];

  for (const academicYear of ACADEMIC_YEARS) {
    const isCurrent = academicYear === CURRENT_YEAR;
    returnRows.push({
      id:                  hesaReturnId(tenantId, academicYear),
      tenantId,
      academicYear,
      statusCode:          isCurrent ? 'draft' : 'submitted',
      submittedAt:         isCurrent ? null : new Date(`${parseInt(academicYear.split('-')[0]!, 10) + 1}-01-15T09:00:00Z`),
      validatedAt:         isCurrent ? null : new Date(`${parseInt(academicYear.split('-')[0]!, 10) + 1}-01-20T09:00:00Z`),
      submissionReference: isCurrent ? null : `DEMO-HESA-${academicYear.replace('-', '')}`,
      generatedBy:         ACTOR,
      generatedAt:         new Date(`${parseInt(academicYear.split('-')[0]!, 10) + 1}-01-10T09:00:00Z`),
    });
  }

  await batchInsert(db, hesaStudentReturns, returnRows);

  // Seed stub student return records for submitted years so record counts are non-zero.
  for (const [academicYear, seqs] of Object.entries(HESA_YEAR_SEQS)) {
    const returnId = hesaReturnId(tenantId, academicYear);
    const recordRows: typeof hesaStudentReturnRecords.$inferInsert[] = seqs
      .filter(seq => seq <= TOTAL_STUDENTS)
      .map(seq => {
        const eId    = enrolmentId(tenantId, seq);
        const husid  = `HESA-${String(seq).padStart(8, '0')}`;
        // Birth year gives students aged ~22-27 depending on seq, all well over the 16-year floor
        const birthYear = 1997 + (seq % 6);
        return {
          id:                  deterministicId('s6-hesa-record', tenantId, academicYear, String(seq)),
          hesaStudentReturnId: returnId,
          enrolmentId:         eId,
          hesaId:              husid,
          recordPayload:       {
            _enrolmentId: eId,
            HUSID:        husid,
            BIRTHDTE:     `${birthYear}-09-01`,
            MODE:         '01',   // full-time
            YEARPRG:      1,
          },
        };
      });
    await batchInsert(db, hesaStudentReturnRecords, recordRows);
  }

  // UCAS applications — 500 representative records across 4 admission cycles.
  // Enrolled students are linked via linkedEnrolmentId; final statuses reflect
  // their outcome (unconditional = enrolled, rejected = no place).
  const UCAS_APP_STATUSES = ['unconditional', 'unconditional', 'unconditional', 'conditional', 'rejected'] as const;
  const UCAS_CYCLES = ['2022', '2023', '2024', '2025'] as const;
  const ucasRows: typeof ucasApplications.$inferInsert[] = [];
  let ucasSeeded = 0;
  for (let seq = 7; seq <= TOTAL_STUDENTS && ucasSeeded < 500; seq++) {
    if (isInternationalForSeq(seq)) continue;
    if (seq % 9 === 0) continue; // direct-entry, not UCAS
    const cycle  = UCAS_CYCLES[(seq - 7) % 4]!;
    const status = UCAS_APP_STATUSES[(seq - 7) % UCAS_APP_STATUSES.length]!;
    const eId    = enrolmentId(tenantId, seq);
    ucasRows.push({
      id:                deterministicId('s6-ucas-app', tenantId, String(seq)),
      tenantId,
      ucasPersonalId:    ucasPersonalId(seq),
      cycle,
      statusCode:        status,
      linkedEnrolmentId: status !== 'rejected' ? eId : null,
      rawPayload:        { source: 'demo', seq },
      validFrom:         new Date(`${cycle}-09-01T00:00:00Z`),
      recordedAt:        new Date(`${cycle}-09-01T00:00:00Z`),
    });
    ucasSeeded++;
  }
  await batchInsert(db, ucasApplications, ucasRows);
}

// ─── Phase: corrections ───────────────────────────────────────────────────────
// 3 PRCs (same pattern as S5, using different seqs so IDs don't clash).

async function loadCorrections(db: Db, tenantId: string): Promise<void> {
  const correctionDate = new Date('2026-07-20T09:00:00Z');

  const cases: typeof postRatificationCases.$inferInsert[] = [
    generatePostRatificationCase(
      tenantId, enrolmentId(tenantId, 1_001), 1_001,
      'administrative-correction', 'upheld', correctionDate,
    ),
    generatePostRatificationCase(
      tenantId, enrolmentId(tenantId, 2_001), 2_001,
      'appeal', 'under-review', correctionDate,
    ),
    generatePostRatificationCase(
      tenantId, enrolmentId(tenantId, 3_001), 3_001,
      'appeal', 'not-upheld', correctionDate,
    ),
  ];
  await batchInsert(db, postRatificationCases, cases);

  // Amendment for the upheld administrative correction (seq 1001)
  const regYear        = registrationYearForSeq(1_001);
  const caseLogicId    = postRatificationCaseLogicalId(tenantId, 1_001);
  const autumnMod      = AUTUMN_MODULES[1_001 % AUTUMN_MODULES.length]!;
  const offeringId     = moduleOfferingId(tenantId, autumnMod.code, regYear, 'AUTUMN');
  const cwCompId       = assessmentComponentId(tenantId, offeringId, 'coursework');
  const correctedRegId = moduleRegistrationId(tenantId, 1_001, 0);
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
