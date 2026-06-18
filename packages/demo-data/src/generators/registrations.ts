import type {
  NewExamBoard,
  NewExamEntry,
  NewModuleRegistration,
} from '@revelation-srs/db';

import { academicPeriodId } from './calendar.js';
import { BASELINE_MODULES, moduleOfferingId } from './curriculum.js';
import { deterministicId } from './ids.js';

// ─── Module lists by primary delivery term ────────────────────────────────────
// Multi-term modules (CS303, EN301) are bucketed under their first term (AUTUMN).

export const AUTUMN_MODULES = BASELINE_MODULES.filter(
  m => m.terms[0] === 'AUTUMN',
);

export const SPRING_MODULES = BASELINE_MODULES.filter(
  m => m.terms[0] === 'SPRING',
);

// ─── Status distribution ──────────────────────────────────────────────────────
// Two slots per student (autumn=0, spring=1).
// Distribution by (seq * 3 + slot * 7) % 20:
//   0-12 → registered (65%)
//  13-14 → withdrawn  (10%)
//     15 → waitlisted  (5%)
//     16 → override    (5%)
//  17-19 → draft      (15%)

export function registrationStatusForSlot(seq: number, slot: number): string {
  const r = (seq * 3 + slot * 7) % 20;
  if (r <= 12) return 'registered';
  if (r <= 14) return 'withdrawn';
  if (r === 15) return 'waitlisted';
  if (r === 16) return 'override';
  return 'draft';
}

// ─── ID helpers ───────────────────────────────────────────────────────────────

export function moduleRegistrationId(tenantId: string, seq: number, slot: number): string {
  return deterministicId('module-registration', tenantId, String(seq), String(slot));
}

export function examBoardIdForPeriod(tenantId: string, academicYear: string, periodCode: string): string {
  return deterministicId('exam-board-module', tenantId, academicYear, periodCode);
}

export function examEntryId(tenantId: string, seq: number, slot: number): string {
  return deterministicId('exam-entry', tenantId, String(seq), String(slot));
}

// ─── Registration generator ───────────────────────────────────────────────────

export interface RegistrationSlot {
  registration: NewModuleRegistration;
  termCode:     'AUTUMN' | 'SPRING';
  slot:         number;
}

export function generateRegistrationsForStudent(
  tenantId:     string,
  seq:          number,
  enrolmentId:  string,
  academicYear: string,
  overrides?: { slot0Status?: string; slot1Status?: string },
): RegistrationSlot[] {
  const autumnMod = AUTUMN_MODULES[seq % AUTUMN_MODULES.length]!;
  const springMod = SPRING_MODULES[seq % SPRING_MODULES.length]!;

  const autumnValidFrom = new Date('2025-09-23T00:00:00Z');
  const springValidFrom = new Date('2026-01-20T00:00:00Z');

  return [
    {
      slot: 0,
      termCode: 'AUTUMN',
      registration: {
        id:               moduleRegistrationId(tenantId, seq, 0),
        tenantId,
        validFrom:        autumnValidFrom,
        recordedAt:       autumnValidFrom,
        enrolmentId,
        moduleOfferingId: moduleOfferingId(tenantId, autumnMod.code, academicYear, 'AUTUMN'),
        statusCode:       overrides?.slot0Status ?? registrationStatusForSlot(seq, 0),
        registrationDate: '2025-09-23',
      },
    },
    {
      slot: 1,
      termCode: 'SPRING',
      registration: {
        id:               moduleRegistrationId(tenantId, seq, 1),
        tenantId,
        validFrom:        springValidFrom,
        recordedAt:       springValidFrom,
        enrolmentId,
        moduleOfferingId: moduleOfferingId(tenantId, springMod.code, academicYear, 'SPRING'),
        statusCode:       overrides?.slot1Status ?? registrationStatusForSlot(seq, 1),
        registrationDate: '2026-01-20',
      },
    },
  ];
}

// ─── Exam board generator ─────────────────────────────────────────────────────

const ACTOR = 'demo-data:module-selection';

export function generateExamBoards(
  tenantId:     string,
  academicYear: string,
): NewExamBoard[] {
  return [
    {
      id:               examBoardIdForPeriod(tenantId, academicYear, 'AUTUMN'),
      tenantId,
      boardTypeCode:    'module',
      academicYear,
      academicPeriodId: academicPeriodId(tenantId, academicYear, 'AUTUMN'),
      meetingDate:      '2026-01-15',
      actorId:          ACTOR,
    },
    {
      id:               examBoardIdForPeriod(tenantId, academicYear, 'SPRING'),
      tenantId,
      boardTypeCode:    'module',
      academicYear,
      academicPeriodId: academicPeriodId(tenantId, academicYear, 'SPRING'),
      meetingDate:      '2026-05-21',
      actorId:          ACTOR,
    },
    {
      id:               examBoardIdForPeriod(tenantId, academicYear, 'SUMMER'),
      tenantId,
      boardTypeCode:    'module',
      academicYear,
      academicPeriodId: academicPeriodId(tenantId, academicYear, 'SUMMER'),
      meetingDate:      '2026-07-09',
      actorId:          ACTOR,
    },
  ];
}

// ─── Exam entry generator ─────────────────────────────────────────────────────
// Exam entries are created only for 'registered' and 'override' registrations.
// Status distribution: (seq + slot * 11) % 20 → 0-17 confirmed, 18 deferred, 19 absent.

function examStatusForSlot(seq: number, slot: number): string {
  const r = (seq + slot * 11) % 20;
  if (r <= 17) return 'confirmed';
  if (r === 18) return 'deferred';
  return 'absent';
}

const EXAM_DATES: Record<'AUTUMN' | 'SPRING', string> = {
  AUTUMN: '2026-01-12',
  SPRING: '2026-05-18',
};

export function generateExamEntry(
  tenantId:             string,
  seq:                  number,
  slot:                 RegistrationSlot,
  examBoardId:          string,
): NewExamEntry {
  const candidateSeq = seq * 2 + slot.slot;
  return {
    id:                   examEntryId(tenantId, seq, slot.slot),
    tenantId,
    validFrom:            slot.registration.validFrom,
    recordedAt:           slot.registration.validFrom,
    moduleRegistrationId: slot.registration.id,
    examBoardId,
    candidateNumber:      `DEMO-CAND-${String(candidateSeq).padStart(7, '0')}`,
    scheduledDate:        EXAM_DATES[slot.termCode],
    roomReference:        `DEMO-HALL-${((seq + slot.slot) % 5) + 1}`,
    statusCode:           examStatusForSlot(seq, slot.slot),
    accommodations:       {},
  };
}
