import { describe, expect, it } from 'vitest';

import {
  AUTUMN_MODULES,
  SPRING_MODULES,
  examBoardIdForPeriod,
  generateExamBoards,
  generateExamEntry,
  generateRegistrationsForStudent,
  moduleRegistrationId,
  registrationStatusForSlot,
} from '../src/generators/registrations.js';
import { STORY_MARKERS } from '../src/story-markers.js';

const TENANT_ID = 'b0000000-0000-4000-8000-000000000001';
const ENROL_ID  = 'b0000000-0000-4000-8000-000000000002';
const YEAR      = '2025-26';

// ─── Module lists ─────────────────────────────────────────────────────────────

describe('AUTUMN_MODULES', () => {
  it('contains only modules delivered in autumn', () => {
    for (const m of AUTUMN_MODULES) {
      expect(m.terms[0]).toBe('AUTUMN');
    }
  });

  it('is non-empty', () => {
    expect(AUTUMN_MODULES.length).toBeGreaterThan(0);
  });
});

describe('SPRING_MODULES', () => {
  it('contains only modules delivered in spring', () => {
    for (const m of SPRING_MODULES) {
      expect(m.terms[0]).toBe('SPRING');
    }
  });

  it('is non-empty', () => {
    expect(SPRING_MODULES.length).toBeGreaterThan(0);
  });
});

// ─── Status distribution ──────────────────────────────────────────────────────

describe('registrationStatusForSlot', () => {
  it('returns one of the five valid statuses', () => {
    const valid = new Set(['registered', 'withdrawn', 'waitlisted', 'override', 'draft']);
    for (let seq = 1; seq <= 100; seq++) {
      for (const slot of [0, 1]) {
        expect(valid.has(registrationStatusForSlot(seq, slot))).toBe(true);
      }
    }
  });

  it('registered is the most common status', () => {
    let registered = 0;
    for (let seq = 1; seq <= 500; seq++) {
      for (const slot of [0, 1]) {
        if (registrationStatusForSlot(seq, slot) === 'registered') registered++;
      }
    }
    // Expect >50% of all slots to be registered (target is 65%)
    expect(registered).toBeGreaterThan(500);
  });

  it('all five statuses appear across 200 students', () => {
    const seen = new Set<string>();
    for (let seq = 1; seq <= 200; seq++) {
      for (const slot of [0, 1]) {
        seen.add(registrationStatusForSlot(seq, slot));
      }
    }
    expect(seen.has('registered')).toBe(true);
    expect(seen.has('withdrawn')).toBe(true);
    expect(seen.has('waitlisted')).toBe(true);
    expect(seen.has('override')).toBe(true);
    expect(seen.has('draft')).toBe(true);
  });

  it('is stable across calls', () => {
    expect(registrationStatusForSlot(42, 0)).toBe(registrationStatusForSlot(42, 0));
    expect(registrationStatusForSlot(42, 1)).toBe(registrationStatusForSlot(42, 1));
  });
});

// ─── ID helpers ───────────────────────────────────────────────────────────────

describe('moduleRegistrationId', () => {
  it('produces a valid UUID', () => {
    const id = moduleRegistrationId(TENANT_ID, 1, 0);
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it('is stable', () => {
    expect(moduleRegistrationId(TENANT_ID, 5, 1)).toBe(moduleRegistrationId(TENANT_ID, 5, 1));
  });

  it('differs by seq', () => {
    expect(moduleRegistrationId(TENANT_ID, 1, 0)).not.toBe(moduleRegistrationId(TENANT_ID, 2, 0));
  });

  it('differs by slot', () => {
    expect(moduleRegistrationId(TENANT_ID, 1, 0)).not.toBe(moduleRegistrationId(TENANT_ID, 1, 1));
  });
});

describe('examBoardIdForPeriod', () => {
  it('is stable', () => {
    expect(examBoardIdForPeriod(TENANT_ID, YEAR, 'AUTUMN')).toBe(examBoardIdForPeriod(TENANT_ID, YEAR, 'AUTUMN'));
  });

  it('differs by period', () => {
    expect(examBoardIdForPeriod(TENANT_ID, YEAR, 'AUTUMN')).not.toBe(examBoardIdForPeriod(TENANT_ID, YEAR, 'SPRING'));
    expect(examBoardIdForPeriod(TENANT_ID, YEAR, 'SPRING')).not.toBe(examBoardIdForPeriod(TENANT_ID, YEAR, 'SUMMER'));
  });
});

// ─── generateRegistrationsForStudent ─────────────────────────────────────────

describe('generateRegistrationsForStudent', () => {
  it('returns exactly 2 slots', () => {
    const slots = generateRegistrationsForStudent(TENANT_ID, 1, ENROL_ID, YEAR);
    expect(slots).toHaveLength(2);
  });

  it('first slot is AUTUMN, second is SPRING', () => {
    const slots = generateRegistrationsForStudent(TENANT_ID, 1, ENROL_ID, YEAR);
    expect(slots[0]!.termCode).toBe('AUTUMN');
    expect(slots[1]!.termCode).toBe('SPRING');
  });

  it('uses the provided enrolmentId', () => {
    const slots = generateRegistrationsForStudent(TENANT_ID, 1, ENROL_ID, YEAR);
    for (const s of slots) {
      expect(s.registration.enrolmentId).toBe(ENROL_ID);
    }
  });

  it('applies status overrides', () => {
    const slots = generateRegistrationsForStudent(TENANT_ID, 1, ENROL_ID, YEAR, {
      slot0Status: 'waitlisted',
      slot1Status: 'override',
    });
    expect(slots[0]!.registration.statusCode).toBe('waitlisted');
    expect(slots[1]!.registration.statusCode).toBe('override');
  });

  it('IDs are stable across calls', () => {
    const a = generateRegistrationsForStudent(TENANT_ID, 7, ENROL_ID, YEAR);
    const b = generateRegistrationsForStudent(TENANT_ID, 7, ENROL_ID, YEAR);
    expect(a[0]!.registration.id).toBe(b[0]!.registration.id);
    expect(a[1]!.registration.id).toBe(b[1]!.registration.id);
  });

  it('IDs differ between students', () => {
    const a = generateRegistrationsForStudent(TENANT_ID, 1, ENROL_ID, YEAR);
    const b = generateRegistrationsForStudent(TENANT_ID, 2, ENROL_ID, YEAR);
    expect(a[0]!.registration.id).not.toBe(b[0]!.registration.id);
  });

  it('autumn slot has registrationDate in September', () => {
    const slots = generateRegistrationsForStudent(TENANT_ID, 1, ENROL_ID, YEAR);
    expect(slots[0]!.registration.registrationDate).toMatch(/^2025-09/);
  });

  it('spring slot has registrationDate in January', () => {
    const slots = generateRegistrationsForStudent(TENANT_ID, 1, ENROL_ID, YEAR);
    expect(slots[1]!.registration.registrationDate).toMatch(/^2026-01/);
  });
});

// ─── generateExamBoards ───────────────────────────────────────────────────────

describe('generateExamBoards', () => {
  it('returns 3 boards', () => {
    expect(generateExamBoards(TENANT_ID, YEAR)).toHaveLength(3);
  });

  it('all boards are type "module"', () => {
    for (const board of generateExamBoards(TENANT_ID, YEAR)) {
      expect(board.boardTypeCode).toBe('module');
    }
  });

  it('all boards have the correct academic year', () => {
    for (const board of generateExamBoards(TENANT_ID, YEAR)) {
      expect(board.academicYear).toBe(YEAR);
    }
  });

  it('all board IDs are unique', () => {
    const ids = generateExamBoards(TENANT_ID, YEAR).map(b => b.id);
    expect(new Set(ids).size).toBe(3);
  });

  it('board IDs are stable', () => {
    const a = generateExamBoards(TENANT_ID, YEAR);
    const b = generateExamBoards(TENANT_ID, YEAR);
    for (let i = 0; i < 3; i++) {
      expect(a[i]!.id).toBe(b[i]!.id);
    }
  });
});

// ─── generateExamEntry ────────────────────────────────────────────────────────

describe('generateExamEntry', () => {
  const slots = generateRegistrationsForStudent(TENANT_ID, 10, ENROL_ID, YEAR);
  const slot0 = slots[0]!;
  const boardId = examBoardIdForPeriod(TENANT_ID, YEAR, 'AUTUMN');
  const entry = generateExamEntry(TENANT_ID, 10, slot0, boardId);

  it('candidateNumber starts with DEMO-CAND-', () => {
    expect(entry.candidateNumber).toMatch(/^DEMO-CAND-/);
  });

  it('statusCode is one of confirmed/deferred/absent', () => {
    expect(['confirmed', 'deferred', 'absent']).toContain(entry.statusCode);
  });

  it('roomReference starts with DEMO-HALL-', () => {
    expect(entry.roomReference).toMatch(/^DEMO-HALL-/);
  });

  it('scheduledDate is a valid date string', () => {
    expect(entry.scheduledDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('references the correct exam board', () => {
    expect(entry.examBoardId).toBe(boardId);
  });

  it('references the correct module registration', () => {
    expect(entry.moduleRegistrationId).toBe(slot0.registration.id);
  });

  it('ID is stable', () => {
    const a = generateExamEntry(TENANT_ID, 10, slot0, boardId);
    const b = generateExamEntry(TENANT_ID, 10, slot0, boardId);
    expect(a.id).toBe(b.id);
  });

  it('confirmed is the dominant exam status across 200 students', () => {
    let confirmed = 0;
    for (let seq = 1; seq <= 200; seq++) {
      const s = generateRegistrationsForStudent(TENANT_ID, seq, ENROL_ID, YEAR);
      const bId = examBoardIdForPeriod(TENANT_ID, YEAR, 'AUTUMN');
      const e = generateExamEntry(TENANT_ID, seq, s[0]!, bId);
      if (e.statusCode === 'confirmed') confirmed++;
    }
    expect(confirmed).toBeGreaterThan(160); // >80%
  });
});

// ─── Story markers ────────────────────────────────────────────────────────────

describe('S3 story markers', () => {
  it('S3 markers are present in STORY_MARKERS', () => {
    expect(STORY_MARKERS.S3_ALICE_REGISTERED).toBeDefined();
    expect(STORY_MARKERS.S3_BOB_WAITLISTED).toBeDefined();
    expect(STORY_MARKERS.S3_CAROL_OVERRIDE).toBeDefined();
  });

  it('all S3 marker values are unique', () => {
    const s3 = [
      STORY_MARKERS.S3_ALICE_REGISTERED,
      STORY_MARKERS.S3_BOB_WAITLISTED,
      STORY_MARKERS.S3_CAROL_OVERRIDE,
    ];
    expect(new Set(s3).size).toBe(3);
  });
});
