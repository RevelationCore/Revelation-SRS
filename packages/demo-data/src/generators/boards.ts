import type {
  NewAward,
  NewExamBoard,
  NewExamBoardCandidateProfile,
  NewExamBoardDataPack,
  NewExamBoardMemberAttendance,
  NewExternalExaminerSignoff,
  NewPostRatificationAmendment,
  NewPostRatificationCase,
  NewProgressionDecision,
} from '@revelation-srs/db';

import { deterministicId } from './ids.js';

const ACTOR = 'demo-data:exam-board';

// ─── ID helpers ───────────────────────────────────────────────────────────────

export function awardBoardId(tenantId: string, academicYear: string): string {
  return deterministicId('exam-board-award', tenantId, academicYear);
}

export function boardDataPackId(tenantId: string, boardId: string): string {
  return deterministicId('board-data-pack', tenantId, boardId);
}

export function progressionDecisionLogicalId(
  tenantId:     string,
  enrolmentId:  string,
  academicYear: string,
): string {
  return deterministicId('progression-decision', tenantId, enrolmentId, academicYear);
}

export function awardLogicalId(tenantId: string, enrolmentId: string): string {
  return deterministicId('award', tenantId, enrolmentId);
}

export function postRatificationCaseLogicalId(tenantId: string, seq: number): string {
  return deterministicId('post-ratification-case', tenantId, String(seq));
}

// ─── Decision code distribution ──────────────────────────────────────────────
// seq 2 (bob) is hardcoded 'resit' (EC claim affected his autumn module result).
// seq % 30 === 0: repeat-year (~3%)
// seq % 8 === 0:  resit (~12%, minus overlaps with above)
// remainder:      progress (~85%)

export function progressionDecisionCode(seq: number): string {
  if (seq === 2)      return 'resit';
  if (seq % 30 === 0) return 'repeat-year';
  if (seq % 8 === 0)  return 'resit';
  return 'progress';
}

// ─── Award classification distribution ───────────────────────────────────────
// seq % 4: first (25%), upper-second (25%), lower-second (25%), third (25%)

export function classificationCode(seq: number): string {
  const r = seq % 4;
  if (r === 0) return 'first';
  if (r === 1) return 'upper-second';
  if (r === 2) return 'lower-second';
  return 'third';
}

// Derive qualification code from programme code (matches BASELINE_PROGRAMMES).
export function qualCodeForProgramme(programmeCode: string): string {
  if (programmeCode === 'MENGCS')              return 'MEng';
  if (programmeCode === 'LLBLAW')              return 'LLB';
  if (programmeCode.startsWith('MSC'))         return 'MSc';
  if (programmeCode.startsWith('BA'))          return 'BA';
  return 'BSc';
}

// ─── Award board generator ────────────────────────────────────────────────────

export function generateAwardBoard(
  tenantId:     string,
  academicYear: string,
): NewExamBoard {
  return {
    id:               awardBoardId(tenantId, academicYear),
    tenantId,
    boardTypeCode:    'award',
    academicYear,
    academicPeriodId: null,
    meetingDate:      '2026-07-10',
    actorId:          ACTOR,
  };
}

// ─── Data pack generator ──────────────────────────────────────────────────────

export function generateDataPack(
  tenantId:       string,
  boardId:        string,
  candidateCount: number,
  generatedAt:    Date,
): NewExamBoardDataPack {
  return {
    id:                    boardDataPackId(tenantId, boardId),
    tenantId,
    examBoardId:           boardId,
    packVersion:           1,
    sourceTransactionTime: generatedAt,
    candidateCount,
    generatedAt,
    generatedBy:           ACTOR,
  };
}

// ─── Candidate profile generator ──────────────────────────────────────────────

export function generateCandidateProfile(
  tenantId:    string,
  dataPackId:  string,
  enrolmentId: string,
  personId:    string,
  profileData: Record<string, unknown>,
): NewExamBoardCandidateProfile {
  return {
    id:          deterministicId('candidate-profile', tenantId, dataPackId, enrolmentId),
    tenantId,
    dataPackId,
    enrolmentId,
    personId,
    profileData,
  };
}

// ─── Member attendance generator ──────────────────────────────────────────────

export function generateMemberAttendance(
  tenantId:   string,
  boardId:    string,
  roleCode:   string,
  actorId:    string,
  attendedAt: Date,
): NewExamBoardMemberAttendance {
  return {
    id:          deterministicId('board-attendance', tenantId, boardId, actorId),
    tenantId,
    examBoardId: boardId,
    actorId,
    roleCode,
    attendedAt,
  };
}

// ─── External examiner sign-off generator ─────────────────────────────────────

export function generateExternalExaminerSignoff(
  tenantId:    string,
  boardId:     string,
  actorId:     string,
  signedOffAt: Date,
): NewExternalExaminerSignoff {
  return {
    id:          deterministicId('ext-examiner-signoff', tenantId, boardId),
    tenantId,
    examBoardId: boardId,
    actorId,
    commentary:  'DEMO - Synthetic external examiner sign-off. No concerns raised.',
    signedOffAt,
  };
}

// ─── Progression decision generator ──────────────────────────────────────────

export function generateProgressionDecision(
  tenantId:     string,
  enrolmentId:  string,
  academicYear: string,
  yearOfStudy:  string,
  decisionCode: string,
  examBoardId:  string,
  validFrom:    Date,
): NewProgressionDecision {
  const logicId = progressionDecisionLogicalId(tenantId, enrolmentId, academicYear);
  return {
    versionId:    logicId,
    id:           logicId,
    tenantId,
    validFrom,
    recordedAt:   validFrom,
    enrolmentId,
    academicYear,
    yearOfStudy,
    decisionCode,
    examBoardId,
    locked:       true,
    actorId:      ACTOR,
  };
}

// ─── Award generator ──────────────────────────────────────────────────────────

export function generateAward(
  tenantId:          string,
  enrolmentId:       string,
  personId:          string,
  examBoardId:       string,
  qualificationCode: string,
  classCode:         string,
  awardDate:         string,
  validFrom:         Date,
): NewAward {
  const logicId = awardLogicalId(tenantId, enrolmentId);
  return {
    versionId:          logicId,
    id:                 logicId,
    tenantId,
    validFrom,
    recordedAt:         validFrom,
    enrolmentId,
    personId,
    examBoardId,
    qualificationCode,
    classificationCode: classCode,
    awardDate,
    actorId:            ACTOR,
  };
}

// ─── Post-ratification case generator ────────────────────────────────────────

export function generatePostRatificationCase(
  tenantId:     string,
  enrolmentId:  string,
  seq:          number,
  caseTypeCode: string,
  statusCode:   string,
  validFrom:    Date,
): NewPostRatificationCase {
  const logicId = postRatificationCaseLogicalId(tenantId, seq);
  return {
    versionId:    logicId,
    id:           logicId,
    tenantId,
    validFrom,
    recordedAt:   validFrom,
    enrolmentId,
    caseTypeCode,
    statusCode,
    reference:    `DEMO-PRC-${String(seq).padStart(5, '0')}`,
    actorId:      ACTOR,
  };
}

// ─── Post-ratification amendment generator ────────────────────────────────────

export function generatePostRatificationAmendment(
  tenantId:    string,
  caseId:      string,
  entityType:  string,
  entityId:    string,
  beforeValue: Record<string, unknown>,
  afterValue:  Record<string, unknown>,
  amendedAt:   Date,
): NewPostRatificationAmendment {
  return {
    id:           deterministicId('pra', tenantId, caseId, entityId),
    tenantId,
    caseId,
    entityType,
    entityId,
    beforeValue,
    afterValue,
    authorisedBy: ACTOR,
    amendedAt,
  };
}
