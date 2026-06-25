import {
  academicPeriods,
  assessmentComponents,
  awardingBodies,
  enrolments,
  examBoards,
  examEntries,
  integrationExchanges,
  integrationRegistrations,
  marks,
  moduleOfferings,
  moduleRegistrations,
  moduleResults,
  modules,
  notifications,
  personIdentities,
  persons,
  programmes,
  reasonableAdjustments,
  studentAddresses,
  studentContactMethods,
  type Db,
} from '@revelation-srs/db';

import {
  assessmentComponentId,
  buildVleExchange,
  buildVleRegistration,
  flattenBundles,
  generateAdjustmentCase,
  generateComponentsForOffering,
  generateCurriculum,
  generateDisabilitySupportCase,
  generateEcClaim,
  generateExamBoards,
  generateExamEntry,
  generateMark,
  generateMentalHealthCase,
  generateModuleResult,
  generateMultiYearCalendar,
  generatePersonBundle,
  generateRegistrationsForStudent,
  generateWellbeingCase,
  getModuleOfferingsForYear,
  hasEcClaim,
  hasMentalHealthCase,
  hasWellbeingCase,
  lookupVleContractId,
  personId as mkPersonId,
  rawMarkForSlot,
  ucasPersonalId,
  vleRegistrationId,
  wellbeingSchemaExists,
} from '../generators/index.js';
import {
  adjustmentCasesTable,
  disabilitySupportCasesTable,
  ecClaimsTable,
  mentalHealthCasesTable,
  wellbeingCasesTable,
} from '../generators/wellbeing.js';
import { provisionPersonas } from '../generators/keycloak.js';
import { BASELINE_PROGRAMMES } from '../generators/curriculum.js';
import { programmeId } from '../generators/curriculum.js';
import { examBoardIdForPeriod } from '../generators/registrations.js';
import { STORY_MARKERS } from '../story-markers.js';
import type { ScenarioManifest } from '../types.js';
import { batchInsert } from '../utils/batch.js';
import { deterministicId } from '../generators/ids.js';

export const manifest: ScenarioManifest = {
  slug:             'assessment-marks',
  name:             'S4 — Assessment Marks',
  schemaVersion:    '0023',
  referenceDate:    '2026-01-30',
  academicYears:    ['2024-25', '2025-26'],
  targetVolumes:    {
    students:              1_000,
    enrolments:            1_000,
    moduleRegistrations:   2_000,
    assessmentComponents:     78,
    marks:                 2_800,
    moduleResults:         1_400,
    wellbeingCases:           20,
    disabilityCases:          20,
    adjustmentCases:          20,
    ecClaims:                  5,
    mentalHealthCases:          3,
  },
  loadTimeBudgetMs: 180_000,
  storyMarkers:     [
    STORY_MARKERS.S4_ALICE_MARKED,
    STORY_MARKERS.S4_BOB_EC_CLAIM,
    STORY_MARKERS.S4_CAROL_ADJUSTMENT,
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
    'notifications',
  ],
};

// ─── Constants ────────────────────────────────────────────────────────────────

const TOTAL_STUDENTS  = 1_000;
const ACADEMIC_YEAR   = '2025-26';
const VALID_FROM      = new Date('2025-08-01T00:00:00Z');
const MARK_DATE       = new Date('2026-01-30T00:00:00Z');
const ACTOR           = 'demo-data:assessment-marks';

// ─── Derived status helpers (mirrors S2 distribution) ────────────────────────

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

function enrolmentId(tenantId: string, seq: number): string {
  return deterministicId('s4-enrolment', tenantId, String(seq));
}

function reasonableAdjustmentId(tenantId: string, seq: number): string {
  return deterministicId('s4-adjustment', tenantId, String(seq));
}

// ─── Story-marker overrides ───────────────────────────────────────────────────

// seq 1 = alice: all marks submitted (normal path)
// seq 2 = bob:   EC claim submitted (spring module affected)
// seq 3 = carol: disability declaration, DSA, reasonable adjustment

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
    case 'notifications':  return loadNotifications(db, tenantId);
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

  // Story markers (seqs 1-3): all enrolled, UCAS-sourced
  const SM = [
    { seq: 1, personaSource: ucasPersonalId(1) },
    { seq: 2, personaSource: ucasPersonalId(2) },
    { seq: 3, personaSource: ucasPersonalId(3) },
  ];
  for (const sm of SM) {
    bundles.push(generatePersonBundle(tenantId, sm.seq, {
      statusCode:         'enrolled',
      sourceSystem:       'ucas',
      sourceReference:    sm.personaSource,
      includeTermAddress: true,
      validFrom:          VALID_FROM,
    }));
  }

  // General students (seqs 4-TOTAL_STUDENTS)
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
    const progId    = programmeId(tenantId, BASELINE_PROGRAMMES[seq % BASELINE_PROGRAMMES.length]!.code);

    return {
      id:                  enrolmentId(tenantId, seq),
      tenantId,
      personId:            mkPersonId(tenantId, seq),
      programmeId:         progId,
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
  const allExamBoards    = generateExamBoards(tenantId, ACADEMIC_YEAR);
  const allExamEntries   = [];

  for (let seq = 1; seq <= TOTAL_STUDENTS; seq++) {
    const enrollId = enrolmentId(tenantId, seq);
    const status   = statusCodeForSeq(seq);
    if (status !== 'enrolled') continue;

    const overrides =
      seq === 1 ? {} :
      seq === 2 ? { slot1Status: 'registered' as const } :
      seq === 3 ? { slot0Status: 'override' as const } : undefined;

    const slots = generateRegistrationsForStudent(tenantId, seq, enrollId, ACADEMIC_YEAR, overrides);
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
  await batchInsert(db, examBoards,         allExamBoards);
  await batchInsert(db, examEntries,        allExamEntries);
}

// ─── Phase: assessment ────────────────────────────────────────────────────────

async function loadAssessment(db: Db, tenantId: string): Promise<void> {
  // 1. Generate assessment components for all module offerings in ACADEMIC_YEAR
  const offerings = getModuleOfferingsForYear(tenantId, ACADEMIC_YEAR);
  const componentPairs = offerings.map(o =>
    generateComponentsForOffering(tenantId, o.offeringId, o.title, MARK_DATE),
  );
  const allComponents = componentPairs.flatMap(p => [p.coursework, p.exam]);
  await batchInsert(db, assessmentComponents, allComponents);

  // Build a quick lookup: offering → component IDs (coursework=0, exam=1)
  const componentsByOffering = new Map<string, [string, string]>();
  for (const p of componentPairs) {
    componentsByOffering.set(p.coursework.moduleOfferingId, [p.coursework.id!, p.exam.id!]);
  }

  // Build offering→termCode lookup
  const offeringTermMap = new Map<string, 'AUTUMN' | 'SPRING'>();
  for (const o of offerings) {
    offeringTermMap.set(o.offeringId, o.termCode);
  }

  // 2. Generate marks and module results for registered/override students
  const allMarks:   typeof marks.$inferInsert[]         = [];
  const allResults: typeof moduleResults.$inferInsert[] = [];

  for (let seq = 1; seq <= TOTAL_STUDENTS; seq++) {
    const status = statusCodeForSeq(seq);
    if (status !== 'enrolled') continue;

    const enrollId = enrolmentId(tenantId, seq);
    const slots    = generateRegistrationsForStudent(tenantId, seq, enrollId, ACADEMIC_YEAR);

    for (const s of slots) {
      const regStatus = s.registration.statusCode;
      if (regStatus !== 'registered' && regStatus !== 'override') continue;

      const regId    = s.registration.id;
      const offeringId = s.registration.moduleOfferingId;
      const compIds  = componentsByOffering.get(offeringId);
      if (!compIds) continue;

      const cwMark   = rawMarkForSlot(seq, s.slot, 0);
      const examMark = rawMarkForSlot(seq, s.slot, 1);

      allMarks.push(generateMark(tenantId, regId, compIds[0], seq, s.slot, 0, MARK_DATE));
      allMarks.push(generateMark(tenantId, regId, compIds[1], seq, s.slot, 1, MARK_DATE));
      allResults.push(generateModuleResult(tenantId, regId, cwMark, examMark, MARK_DATE));
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

  const wellbeingCaseRows:         typeof wellbeingCasesTable.$inferInsert[]         = [];
  const disabilityRows:             typeof disabilitySupportCasesTable.$inferInsert[] = [];
  const adjustmentCaseRows:        typeof adjustmentCasesTable.$inferInsert[]        = [];
  const mentalHealthRows:           typeof mentalHealthCasesTable.$inferInsert[]      = [];
  const ecClaimRows:                typeof ecClaimsTable.$inferInsert[]               = [];
  const srsAdjustmentRows:         typeof reasonableAdjustments.$inferInsert[]       = [];

  for (let seq = 1; seq <= TOTAL_STUDENTS; seq++) {
    const status = statusCodeForSeq(seq);
    if (status !== 'enrolled') continue;

    const isCarolStoryMarker = (seq === 3);
    const isBobStoryMarker   = (seq === 2);

    // Story markers: carol always gets a disability+adjustment, bob always gets EC
    const needsWellbeing = hasWellbeingCase(seq) || isCarolStoryMarker || isBobStoryMarker;
    if (!needsWellbeing) continue;

    const pId      = mkPersonId(tenantId, seq);
    const enrollId = enrolmentId(tenantId, seq);

    wellbeingCaseRows.push(generateWellbeingCase(tenantId, pId, seq));

    if (!isBobStoryMarker) {
      disabilityRows.push(generateDisabilitySupportCase(tenantId, pId, seq));
      adjustmentCaseRows.push(generateAdjustmentCase(tenantId, pId, seq));

      // SRS-side reasonable adjustment
      const adjLogicId = reasonableAdjustmentId(tenantId, seq);
      srsAdjustmentRows.push({
        versionId:          adjLogicId,
        id:                 adjLogicId,
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

    if (isBobStoryMarker || hasEcClaim(seq)) {
      ecClaimRows.push(generateEcClaim(tenantId, pId, enrollId, seq));
    }

    if (hasMentalHealthCase(seq)) {
      mentalHealthRows.push(generateMentalHealthCase(tenantId, pId, seq));
    }
  }

  // Insert SRS-side wellbeing data
  await batchInsert(db, reasonableAdjustments, srsAdjustmentRows);

  // Insert wellbeing-schema data
  if (wellbeingCaseRows.length > 0) {
    await batchInsert(db, wellbeingCasesTable, wellbeingCaseRows);
  }
  if (disabilityRows.length > 0) {
    await batchInsert(db, disabilitySupportCasesTable, disabilityRows);
  }
  if (adjustmentCaseRows.length > 0) {
    await batchInsert(db, adjustmentCasesTable, adjustmentCaseRows);
  }
  if (mentalHealthRows.length > 0) {
    await batchInsert(db, mentalHealthCasesTable, mentalHealthRows);
  }
  if (ecClaimRows.length > 0) {
    await batchInsert(db, ecClaimsTable, ecClaimRows);
  }
}

// ─── Phase: integration ───────────────────────────────────────────────────────

async function loadIntegration(db: Db, tenantId: string): Promise<void> {
  const vleContractId = await lookupVleContractId(db);
  if (!vleContractId) {
    console.warn('[demo-data] VLE integration contract not found — skipping integration phase');
    return;
  }

  const registration = buildVleRegistration(tenantId, vleContractId);
  await batchInsert(db, integrationRegistrations, [registration]);

  const vleRegId   = vleRegistrationId(tenantId);
  const offerings  = getModuleOfferingsForYear(tenantId, ACADEMIC_YEAR);

  // Map offeringId → [cwComponentId, examComponentId]
  const componentMap = new Map<string, [string, string]>();
  for (const o of offerings) {
    componentMap.set(o.offeringId, [
      assessmentComponentId(tenantId, o.offeringId, 'coursework'),
      assessmentComponentId(tenantId, o.offeringId, 'exam'),
    ]);
  }

  const exchanges: typeof integrationExchanges.$inferInsert[] = [];

  for (let seq = 1; seq <= TOTAL_STUDENTS; seq++) {
    const status = statusCodeForSeq(seq);
    if (status !== 'enrolled') continue;

    const enrollId = enrolmentId(tenantId, seq);
    const slots    = generateRegistrationsForStudent(tenantId, seq, enrollId, ACADEMIC_YEAR);

    for (const s of slots) {
      const regStatus = s.registration.statusCode;
      if (regStatus !== 'registered' && regStatus !== 'override') continue;

      const regId   = s.registration.id;
      const compIds = componentMap.get(s.registration.moduleOfferingId);
      if (!compIds) continue;

      for (const compId of compIds) {
        exchanges.push(buildVleExchange(tenantId, vleRegId, regId, compId, seq, MARK_DATE));
      }
    }
  }

  await batchInsert(db, integrationExchanges, exchanges);
}

// ─── Phase: notifications ─────────────────────────────────────────────────────

async function loadNotifications(db: Db, tenantId: string): Promise<void> {
  const now = new Date('2026-01-30T09:00:00Z');

  const rows: typeof notifications.$inferInsert[] = [
    // Alice (seq 1) — marks posted and module result available
    {
      id:        deterministicId('s4-notification', tenantId, '1', 'marks'),
      tenantId,
      personId:  mkPersonId(tenantId, 1),
      category:  'assessment',
      title:     'Your marks have been posted',
      body:      'Marks have been submitted for all your registered modules. You can view your results on the Marks & Results page.',
      linkUrl:   '/results',
      createdAt: now,
    },
    {
      id:        deterministicId('s4-notification', tenantId, '1', 'result'),
      tenantId,
      personId:  mkPersonId(tenantId, 1),
      category:  'assessment',
      title:     'Module results are available',
      body:      'Your module results for 2025–26 have been calculated and are ready to view.',
      linkUrl:   '/results',
      createdAt: new Date('2026-01-30T10:00:00Z'),
    },
    // Bob (seq 2) — EC claim outcome
    {
      id:        deterministicId('s4-notification', tenantId, '2', 'ec'),
      tenantId,
      personId:  mkPersonId(tenantId, 2),
      category:  'circumstances',
      title:     'EC claim outcome recorded',
      body:      'Your extenuating circumstances claim has been reviewed. Please check the Circumstances page for the outcome.',
      linkUrl:   '/circumstances',
      createdAt: now,
    },
    // Carol (seq 3) — adjustment confirmed
    {
      id:        deterministicId('s4-notification', tenantId, '3', 'adjustment'),
      tenantId,
      personId:  mkPersonId(tenantId, 3),
      category:  'adjustments',
      title:     'Learning adjustment confirmed',
      body:      'Your reasonable adjustment has been approved and recorded. It will be applied to all forthcoming assessments.',
      linkUrl:   '/adjustments',
      createdAt: now,
    },
  ];

  await batchInsert(db, notifications, rows);
}
