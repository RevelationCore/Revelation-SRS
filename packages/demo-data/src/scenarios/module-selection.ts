import {
  academicPeriods,
  awardingBodies,
  enrolments,
  examBoards,
  examEntries,
  moduleOfferings,
  moduleRegistrations,
  modules,
  personIdentities,
  persons,
  programmes,
  studentAddresses,
  studentContactMethods,
  type Db,
} from '@revelation-srs/db';

import {
  flattenBundles,
  generateCurriculum,
  generateExamBoards,
  generateExamEntry,
  generateMultiYearCalendar,
  generatePersonBundle,
  generateRegistrationsForStudent,
  personId as mkPersonId,
  ucasPersonalId,
} from '../generators/index.js';
import { provisionPersonas } from '../generators/keycloak.js';
import { BASELINE_PROGRAMMES } from '../generators/curriculum.js';
import { programmeId } from '../generators/curriculum.js';
import { examBoardIdForPeriod } from '../generators/registrations.js';
import { PERSONA_IDS } from '../persona-ids.js';
import { STORY_MARKERS } from '../story-markers.js';
import type { ScenarioManifest } from '../types.js';
import { batchInsert } from '../utils/batch.js';
import { deterministicId } from '../generators/ids.js';

export const manifest: ScenarioManifest = {
  slug:             'module-selection',
  name:             'S3 — Module Selection Peak',
  schemaVersion:    '0023',
  referenceDate:    '2025-11-14',
  academicYears:    ['2025-26'],
  targetVolumes:    {
    students:              1_000,
    enrolments:            1_000,
    moduleRegistrations:   2_000,
    examBoards:                3,
    examEntries:           1_400,
  },
  loadTimeBudgetMs: 120_000,
  storyMarkers:     [
    STORY_MARKERS.S3_ALICE_REGISTERED,
    STORY_MARKERS.S3_BOB_WAITLISTED,
    STORY_MARKERS.S3_CAROL_OVERRIDE,
  ],
  phases: ['reference-data', 'personas', 'persons', 'enrolments', 'registrations', 'boards'],
};

// ─── Constants ────────────────────────────────────────────────────────────────

const TOTAL_STUDENTS  = 1_000;
const ACADEMIC_YEAR   = '2025-26';
const VALID_FROM      = new Date('2025-09-23T00:00:00Z');

// ─── Story marker overrides (seqs 1-3) ───────────────────────────────────────

interface S3StoryMarker {
  seq:          number;
  personaId:    string;
  slot0Status:  string;
  slot1Status:  string;
}

const S3_STORY_MARKERS: S3StoryMarker[] = [
  { seq: 1, personaId: PERSONA_IDS.STUDENT_STANDARD,     slot0Status: 'registered', slot1Status: 'registered' },
  { seq: 2, personaId: PERSONA_IDS.STUDENT_INTERMITTING, slot0Status: 'registered', slot1Status: 'waitlisted'  },
  { seq: 3, personaId: PERSONA_IDS.STUDENT_GRADUATED,    slot0Status: 'override',   slot1Status: 'registered'  },
];

// ─── Enrolment ID helper ──────────────────────────────────────────────────────

function enrolmentId(tenantId: string, seq: number): string {
  return deterministicId('s3-enrolment', tenantId, String(seq));
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
    case 'boards':         return loadBoards(db, tenantId);
    default: return;
  }
}

// ─── Phase implementations ────────────────────────────────────────────────────

async function loadReferenceData(db: Db, tenantId: string): Promise<void> {
  const periods    = generateMultiYearCalendar(tenantId, manifest.academicYears);
  const curriculum = generateCurriculum(tenantId, manifest.academicYears);

  await batchInsert(db, academicPeriods, periods);
  await batchInsert(db, awardingBodies,  curriculum.awardingBodies);
  await batchInsert(db, programmes,      curriculum.programmes);
  await batchInsert(db, modules,         curriculum.modules);
  await batchInsert(db, moduleOfferings, curriculum.moduleOfferings);
}

async function loadPersonas(): Promise<void> {
  const hardFail = process.env['KEYCLOAK_REQUIRED'] === 'true';
  await provisionPersonas({ hardFail });
}

async function loadPersons(db: Db, tenantId: string): Promise<void> {
  const bundles = [];

  // Story markers (seqs 1-3) — all enrolled, registration window open
  for (const sm of S3_STORY_MARKERS) {
    bundles.push(generatePersonBundle(tenantId, sm.seq, {
      statusCode:         'enrolled',
      sourceSystem:       'ucas',
      sourceReference:    ucasPersonalId(sm.seq),
      includeTermAddress: true,
      validFrom:          VALID_FROM,
    }));
  }

  // General enrolled students (seqs 4-TOTAL_STUDENTS)
  for (let seq = 4; seq <= TOTAL_STUDENTS; seq++) {
    const isUcas = seq % 9 !== 0;
    bundles.push(generatePersonBundle(tenantId, seq, {
      statusCode:         'enrolled',
      sourceSystem:       isUcas ? 'ucas' : 'direct',
      ...(isUcas ? { sourceReference: ucasPersonalId(seq) } : {}),
      includeTermAddress: true,
      validFrom:          VALID_FROM,
    }));
  }

  const flat = flattenBundles(bundles);
  await batchInsert(db, persons,               flat.persons);
  await batchInsert(db, personIdentities,      flat.identities);
  await batchInsert(db, studentAddresses,      flat.addresses);
  await batchInsert(db, studentContactMethods, flat.contactMethods);
}

async function loadEnrolments(db: Db, tenantId: string): Promise<void> {
  const enrolmentRows = [];
  const progIds = BASELINE_PROGRAMMES.map(p => programmeId(tenantId, p.code));

  for (let seq = 1; seq <= TOTAL_STUDENTS; seq++) {
    const pid    = mkPersonId(tenantId, seq);
    const eid    = enrolmentId(tenantId, seq);
    const progId = progIds[seq % progIds.length]!;
    const isUcas = seq % 9 !== 0;

    enrolmentRows.push({
      id:                  eid,
      tenantId,
      validFrom:           VALID_FROM,
      recordedAt:          VALID_FROM,
      personId:            pid,
      programmeId:         progId,
      statusCode:          'enrolled',
      modeOfStudyCode:     'full-time',
      academicYearOfEntry: ACADEMIC_YEAR,
      startDate:           '2025-09-23',
      expectedEndDate:     null,
      actualEndDate:       null,
      feeBandCode:         'home',
      fundingSourceCode:   'slc',
      ucasPersonalId:      isUcas ? ucasPersonalId(seq) : null,
      slcReference:        isUcas ? `SLC${String(seq).padStart(9, '0')}` : null,
    });
  }

  await batchInsert(db, enrolments, enrolmentRows);
}

async function loadRegistrations(db: Db, tenantId: string): Promise<void> {
  const regRows: Record<string, unknown>[] = [];

  // Story markers (seqs 1-3) with forced statuses
  for (const sm of S3_STORY_MARKERS) {
    const eid   = enrolmentId(tenantId, sm.seq);
    const slots = generateRegistrationsForStudent(tenantId, sm.seq, eid, ACADEMIC_YEAR, {
      slot0Status: sm.slot0Status,
      slot1Status: sm.slot1Status,
    });
    for (const s of slots) regRows.push(s.registration);
  }

  // General students
  for (let seq = 4; seq <= TOTAL_STUDENTS; seq++) {
    const eid   = enrolmentId(tenantId, seq);
    const slots = generateRegistrationsForStudent(tenantId, seq, eid, ACADEMIC_YEAR);
    for (const s of slots) regRows.push(s.registration);
  }

  await batchInsert(db, moduleRegistrations, regRows);
}

async function loadBoards(db: Db, tenantId: string): Promise<void> {
  // Exam boards — one per period
  const boards = generateExamBoards(tenantId, ACADEMIC_YEAR);
  for (const board of boards) {
    await db.insert(examBoards).values(board).onConflictDoNothing();
  }

  // Exam entries — only for 'registered' and 'override' registrations
  const entryRows: Record<string, unknown>[] = [];

  const generateEntries = (seq: number, slot0Status: string, slot1Status: string) => {
    const eid   = enrolmentId(tenantId, seq);
    const slots = generateRegistrationsForStudent(tenantId, seq, eid, ACADEMIC_YEAR, {
      slot0Status,
      slot1Status,
    });
    for (const slot of slots) {
      const status = slot.registration.statusCode;
      if (status !== 'registered' && status !== 'override') continue;
      const boardId = examBoardIdForPeriod(tenantId, ACADEMIC_YEAR, slot.termCode);
      entryRows.push(generateExamEntry(tenantId, seq, slot, boardId));
    }
  };

  for (const sm of S3_STORY_MARKERS) {
    generateEntries(sm.seq, sm.slot0Status, sm.slot1Status);
  }

  for (let seq = 4; seq <= TOTAL_STUDENTS; seq++) {
    const slot0Status = registrationStatusForSeq(seq, 0);
    const slot1Status = registrationStatusForSeq(seq, 1);
    generateEntries(seq, slot0Status, slot1Status);
  }

  await batchInsert(db, examEntries, entryRows);
}

// Re-compute status locally (mirrors registrations generator formula)
function registrationStatusForSeq(seq: number, slot: number): string {
  const r = (seq * 3 + slot * 7) % 20;
  if (r <= 12) return 'registered';
  if (r <= 14) return 'withdrawn';
  if (r === 15) return 'waitlisted';
  if (r === 16) return 'override';
  return 'draft';
}
