import { describe, expect, it } from 'vitest';

import {
  awardBoardId,
  awardLogicalId,
  boardDataPackId,
  classificationCode,
  generateAward,
  generateCandidateProfile,
  generateDataPack,
  generateExternalExaminerSignoff,
  generateMemberAttendance,
  generatePostRatificationAmendment,
  generatePostRatificationCase,
  generateProgressionDecision,
  postRatificationCaseLogicalId,
  progressionDecisionCode,
  progressionDecisionLogicalId,
  qualCodeForProgramme,
} from '../src/generators/boards.js';
import { STORY_MARKERS } from '../src/story-markers.js';

const TENANT_ID   = 'c0000000-0000-4000-8000-000000000001';
const BOARD_ID    = 'c0000000-0000-4000-8000-000000000002';
const ENROL_ID    = 'c0000000-0000-4000-8000-000000000003';
const PERSON_ID   = 'c0000000-0000-4000-8000-000000000004';
const PACK_ID     = 'c0000000-0000-4000-8000-000000000005';
const YEAR        = '2025-26';
const DATE        = new Date('2026-07-15T10:00:00Z');

// ─── ID helpers ───────────────────────────────────────────────────────────────

describe('awardBoardId', () => {
  it('returns a valid UUID', () => {
    expect(awardBoardId(TENANT_ID, YEAR))
      .toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it('is stable', () => {
    expect(awardBoardId(TENANT_ID, YEAR)).toBe(awardBoardId(TENANT_ID, YEAR));
  });

  it('differs by tenant', () => {
    const other = 'c0000000-0000-4000-8000-000000000099';
    expect(awardBoardId(TENANT_ID, YEAR)).not.toBe(awardBoardId(other, YEAR));
  });
});

describe('boardDataPackId', () => {
  it('is stable', () => {
    expect(boardDataPackId(TENANT_ID, BOARD_ID)).toBe(boardDataPackId(TENANT_ID, BOARD_ID));
  });

  it('differs by board', () => {
    const other = 'c0000000-0000-4000-8000-000000000099';
    expect(boardDataPackId(TENANT_ID, BOARD_ID)).not.toBe(boardDataPackId(TENANT_ID, other));
  });
});

describe('progressionDecisionLogicalId', () => {
  it('is stable', () => {
    expect(progressionDecisionLogicalId(TENANT_ID, ENROL_ID, YEAR))
      .toBe(progressionDecisionLogicalId(TENANT_ID, ENROL_ID, YEAR));
  });

  it('differs by enrolment', () => {
    const other = 'c0000000-0000-4000-8000-000000000099';
    expect(progressionDecisionLogicalId(TENANT_ID, ENROL_ID, YEAR))
      .not.toBe(progressionDecisionLogicalId(TENANT_ID, other, YEAR));
  });
});

describe('awardLogicalId', () => {
  it('is stable', () => {
    expect(awardLogicalId(TENANT_ID, ENROL_ID)).toBe(awardLogicalId(TENANT_ID, ENROL_ID));
  });

  it('differs by enrolment', () => {
    const other = 'c0000000-0000-4000-8000-000000000099';
    expect(awardLogicalId(TENANT_ID, ENROL_ID)).not.toBe(awardLogicalId(TENANT_ID, other));
  });
});

describe('postRatificationCaseLogicalId', () => {
  it('is stable', () => {
    expect(postRatificationCaseLogicalId(TENANT_ID, 101))
      .toBe(postRatificationCaseLogicalId(TENANT_ID, 101));
  });

  it('differs by seq', () => {
    expect(postRatificationCaseLogicalId(TENANT_ID, 101))
      .not.toBe(postRatificationCaseLogicalId(TENANT_ID, 201));
  });
});

// ─── progressionDecisionCode ──────────────────────────────────────────────────

describe('progressionDecisionCode', () => {
  it('seq 1 (alice) → progress', () => {
    expect(progressionDecisionCode(1)).toBe('progress');
  });

  it('seq 2 (bob) → resit (EC claim override)', () => {
    expect(progressionDecisionCode(2)).toBe('resit');
  });

  it('seq 3 (carol) → progress', () => {
    expect(progressionDecisionCode(3)).toBe('progress');
  });

  it('seq 8 → resit (seq % 8 === 0)', () => {
    expect(progressionDecisionCode(8)).toBe('resit');
  });

  it('seq 30 → repeat-year (seq % 30 === 0)', () => {
    expect(progressionDecisionCode(30)).toBe('repeat-year');
  });

  it('seq 32 → resit (seq % 8 === 0, not % 30)', () => {
    expect(progressionDecisionCode(32)).toBe('resit');
  });

  it('produces mostly progress outcomes across 1,000 students', () => {
    let progressCount = 0;
    let resitCount    = 0;
    let repeatCount   = 0;
    for (let seq = 1; seq <= 1_000; seq++) {
      const code = progressionDecisionCode(seq);
      if (code === 'progress')     progressCount++;
      else if (code === 'resit')   resitCount++;
      else if (code === 'repeat-year') repeatCount++;
    }
    expect(progressCount).toBeGreaterThan(700);
    expect(resitCount).toBeGreaterThan(50);
    expect(repeatCount).toBeGreaterThan(10);
  });
});

// ─── classificationCode ───────────────────────────────────────────────────────

describe('classificationCode', () => {
  it('seq % 4 === 0 → first', () => {
    expect(classificationCode(4)).toBe('first');
    expect(classificationCode(8)).toBe('first');
  });

  it('seq % 4 === 1 → upper-second', () => {
    expect(classificationCode(1)).toBe('upper-second');
    expect(classificationCode(5)).toBe('upper-second');
  });

  it('seq % 4 === 2 → lower-second', () => {
    expect(classificationCode(2)).toBe('lower-second');
    expect(classificationCode(6)).toBe('lower-second');
  });

  it('seq % 4 === 3 → third', () => {
    expect(classificationCode(3)).toBe('third');
    expect(classificationCode(7)).toBe('third');
  });

  it('produces four distinct values', () => {
    const codes = [1, 2, 3, 4].map(classificationCode);
    expect(new Set(codes).size).toBe(4);
  });
});

// ─── qualCodeForProgramme ─────────────────────────────────────────────────────

describe('qualCodeForProgramme', () => {
  it('BSCS → BSc', () => {
    expect(qualCodeForProgramme('BSCS')).toBe('BSc');
  });

  it('MENGCS → MEng', () => {
    expect(qualCodeForProgramme('MENGCS')).toBe('MEng');
  });

  it('LLBLAW → LLB', () => {
    expect(qualCodeForProgramme('LLBLAW')).toBe('LLB');
  });

  it('BAENGL → BA', () => {
    expect(qualCodeForProgramme('BAENGL')).toBe('BA');
  });

  it('BAHIST → BA', () => {
    expect(qualCodeForProgramme('BAHIST')).toBe('BA');
  });

  it('MSCDS → MSc', () => {
    expect(qualCodeForProgramme('MSCDS')).toBe('MSc');
  });

  it('MSCFIN → MSc', () => {
    expect(qualCodeForProgramme('MSCFIN')).toBe('MSc');
  });

  it('unknown code falls back to BSc', () => {
    expect(qualCodeForProgramme('UNKNOWN')).toBe('BSc');
  });
});

// ─── generateDataPack ─────────────────────────────────────────────────────────

describe('generateDataPack', () => {
  const pack = generateDataPack(TENANT_ID, BOARD_ID, 42, DATE);

  it('references the correct board', () => {
    expect(pack.examBoardId).toBe(BOARD_ID);
  });

  it('packVersion is 1', () => {
    expect(pack.packVersion).toBe(1);
  });

  it('candidateCount matches input', () => {
    expect(pack.candidateCount).toBe(42);
  });

  it('id is stable', () => {
    expect(pack.id).toBe(generateDataPack(TENANT_ID, BOARD_ID, 42, DATE).id);
  });

  it('id is the board data pack deterministic ID', () => {
    expect(pack.id).toBe(boardDataPackId(TENANT_ID, BOARD_ID));
  });
});

// ─── generateCandidateProfile ─────────────────────────────────────────────────

describe('generateCandidateProfile', () => {
  const profileData = { academicYear: '2025-26', flags: { adjustmentApplied: true } };
  const profile     = generateCandidateProfile(TENANT_ID, PACK_ID, ENROL_ID, PERSON_ID, profileData);

  it('references the correct data pack', () => {
    expect(profile.dataPackId).toBe(PACK_ID);
  });

  it('references the correct enrolment', () => {
    expect(profile.enrolmentId).toBe(ENROL_ID);
  });

  it('references the correct person', () => {
    expect(profile.personId).toBe(PERSON_ID);
  });

  it('profileData is stored correctly', () => {
    expect(profile.profileData).toEqual(profileData);
  });

  it('id is stable', () => {
    const p2 = generateCandidateProfile(TENANT_ID, PACK_ID, ENROL_ID, PERSON_ID, profileData);
    expect(profile.id).toBe(p2.id);
  });
});

// ─── generateMemberAttendance ─────────────────────────────────────────────────

describe('generateMemberAttendance', () => {
  const att = generateMemberAttendance(TENANT_ID, BOARD_ID, 'chair', 'demo-chair', DATE);

  it('roleCode is set correctly', () => {
    expect(att.roleCode).toBe('chair');
  });

  it('examBoardId is set correctly', () => {
    expect(att.examBoardId).toBe(BOARD_ID);
  });

  it('actorId is set correctly', () => {
    expect(att.actorId).toBe('demo-chair');
  });

  it('id is stable', () => {
    const a2 = generateMemberAttendance(TENANT_ID, BOARD_ID, 'chair', 'demo-chair', DATE);
    expect(att.id).toBe(a2.id);
  });

  it('differs by actor (two members have different IDs)', () => {
    const m1 = generateMemberAttendance(TENANT_ID, BOARD_ID, 'member', 'demo-member1', DATE);
    const m2 = generateMemberAttendance(TENANT_ID, BOARD_ID, 'member', 'demo-member2', DATE);
    expect(m1.id).not.toBe(m2.id);
  });
});

// ─── generateExternalExaminerSignoff ─────────────────────────────────────────

describe('generateExternalExaminerSignoff', () => {
  const signoff = generateExternalExaminerSignoff(TENANT_ID, BOARD_ID, 'demo-examiner', DATE);

  it('references the correct board', () => {
    expect(signoff.examBoardId).toBe(BOARD_ID);
  });

  it('commentary starts with DEMO prefix', () => {
    expect(signoff.commentary).toMatch(/^DEMO - /);
  });

  it('id is stable', () => {
    const s2 = generateExternalExaminerSignoff(TENANT_ID, BOARD_ID, 'demo-examiner', DATE);
    expect(signoff.id).toBe(s2.id);
  });
});

// ─── generateProgressionDecision ─────────────────────────────────────────────

describe('generateProgressionDecision', () => {
  const decision = generateProgressionDecision(
    TENANT_ID, ENROL_ID, YEAR, '2', 'progress', BOARD_ID, DATE,
  );

  it('locked is true', () => {
    expect(decision.locked).toBe(true);
  });

  it('decisionCode is set correctly', () => {
    expect(decision.decisionCode).toBe('progress');
  });

  it('academicYear is set correctly', () => {
    expect(decision.academicYear).toBe(YEAR);
  });

  it('yearOfStudy is set correctly', () => {
    expect(decision.yearOfStudy).toBe('2');
  });

  it('examBoardId references the board', () => {
    expect(decision.examBoardId).toBe(BOARD_ID);
  });

  it('versionId equals id (initial version)', () => {
    expect(decision.versionId).toBe(decision.id);
  });

  it('id is stable', () => {
    const d2 = generateProgressionDecision(
      TENANT_ID, ENROL_ID, YEAR, '2', 'progress', BOARD_ID, DATE,
    );
    expect(decision.id).toBe(d2.id);
  });
});

// ─── generateAward ────────────────────────────────────────────────────────────

describe('generateAward', () => {
  const award = generateAward(TENANT_ID, ENROL_ID, PERSON_ID, BOARD_ID, 'BSc', 'upper-second', '2026-07-15', DATE);

  it('qualificationCode is set correctly', () => {
    expect(award.qualificationCode).toBe('BSc');
  });

  it('classificationCode is set correctly', () => {
    expect(award.classificationCode).toBe('upper-second');
  });

  it('awardDate is set correctly', () => {
    expect(award.awardDate).toBe('2026-07-15');
  });

  it('examBoardId references the board', () => {
    expect(award.examBoardId).toBe(BOARD_ID);
  });

  it('versionId equals id (initial version)', () => {
    expect(award.versionId).toBe(award.id);
  });

  it('id is stable', () => {
    const a2 = generateAward(TENANT_ID, ENROL_ID, PERSON_ID, BOARD_ID, 'BSc', 'upper-second', '2026-07-15', DATE);
    expect(award.id).toBe(a2.id);
  });
});

// ─── generatePostRatificationCase ─────────────────────────────────────────────

describe('generatePostRatificationCase', () => {
  const prc = generatePostRatificationCase(
    TENANT_ID, ENROL_ID, 101, 'administrative-correction', 'upheld', DATE,
  );

  it('caseTypeCode is set correctly', () => {
    expect(prc.caseTypeCode).toBe('administrative-correction');
  });

  it('statusCode is set correctly', () => {
    expect(prc.statusCode).toBe('upheld');
  });

  it('reference contains DEMO-PRC prefix', () => {
    expect(prc.reference).toMatch(/^DEMO-PRC-/);
  });

  it('versionId equals id (initial version)', () => {
    expect(prc.versionId).toBe(prc.id);
  });

  it('id is stable', () => {
    const p2 = generatePostRatificationCase(
      TENANT_ID, ENROL_ID, 101, 'administrative-correction', 'upheld', DATE,
    );
    expect(prc.id).toBe(p2.id);
  });
});

// ─── generatePostRatificationAmendment ───────────────────────────────────────

describe('generatePostRatificationAmendment', () => {
  const CASE_ID   = 'c0000000-0000-4000-8000-000000000010';
  const ENTITY_ID = 'c0000000-0000-4000-8000-000000000011';
  const before    = { rawMark: '35', adjustedMark: '35' };
  const after     = { rawMark: '35', adjustedMark: '37' };

  const amendment = generatePostRatificationAmendment(
    TENANT_ID, CASE_ID, 'mark', ENTITY_ID, before, after, DATE,
  );

  it('entityType is set correctly', () => {
    expect(amendment.entityType).toBe('mark');
  });

  it('entityId references the entity', () => {
    expect(amendment.entityId).toBe(ENTITY_ID);
  });

  it('caseId references the case', () => {
    expect(amendment.caseId).toBe(CASE_ID);
  });

  it('beforeValue is stored', () => {
    expect(amendment.beforeValue).toEqual(before);
  });

  it('afterValue is stored', () => {
    expect(amendment.afterValue).toEqual(after);
  });

  it('id is stable', () => {
    const a2 = generatePostRatificationAmendment(
      TENANT_ID, CASE_ID, 'mark', ENTITY_ID, before, after, DATE,
    );
    expect(amendment.id).toBe(a2.id);
  });
});

// ─── S5 story markers ─────────────────────────────────────────────────────────

describe('S5 story markers', () => {
  it('all three S5 markers are defined', () => {
    expect(STORY_MARKERS.S5_ALICE_PROGRESSED).toBeDefined();
    expect(STORY_MARKERS.S5_BOB_RESIT).toBeDefined();
    expect(STORY_MARKERS.S5_CAROL_PROFILE).toBeDefined();
  });

  it('S5 marker values are unique', () => {
    const s5 = [
      STORY_MARKERS.S5_ALICE_PROGRESSED,
      STORY_MARKERS.S5_BOB_RESIT,
      STORY_MARKERS.S5_CAROL_PROFILE,
    ];
    expect(new Set(s5).size).toBe(3);
  });

  it('S5 markers do not collide with S4 markers', () => {
    const allMarkers = Object.values(STORY_MARKERS);
    expect(new Set(allMarkers).size).toBe(allMarkers.length);
  });
});
