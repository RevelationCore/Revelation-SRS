import { describe, expect, it } from 'vitest';

import {
  assessmentComponentId,
  buildVleExchange,
  buildVleRegistration,
  generateComponentsForOffering,
  generateMark,
  generateModuleResult,
  getModuleOfferingsForYear,
  rawMarkForSlot,
} from '../src/generators/assessment.js';
import {
  disabilityCaseId,
  generateAdjustmentCase,
  generateDisabilitySupportCase,
  generateEcClaim,
  generateMentalHealthCase,
  generateWellbeingCase,
  hasEcClaim,
  hasMentalHealthCase,
  hasWellbeingCase,
  wellbeingCaseId,
} from '../src/generators/wellbeing.js';
import { STORY_MARKERS } from '../src/story-markers.js';

const TENANT_ID   = 'b0000000-0000-4000-8000-000000000001';
const OFFERING_ID = 'b0000000-0000-4000-8000-000000000002';
const REG_ID      = 'b0000000-0000-4000-8000-000000000003';
const PERSON_ID   = 'b0000000-0000-4000-8000-000000000004';
const ENROL_ID    = 'b0000000-0000-4000-8000-000000000005';
const YEAR        = '2025-26';
const DATE        = new Date('2026-01-30T00:00:00Z');

// ─── assessmentComponentId ────────────────────────────────────────────────────

describe('assessmentComponentId', () => {
  it('returns a valid UUID', () => {
    expect(assessmentComponentId(TENANT_ID, OFFERING_ID, 'coursework'))
      .toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it('is stable', () => {
    expect(assessmentComponentId(TENANT_ID, OFFERING_ID, 'coursework'))
      .toBe(assessmentComponentId(TENANT_ID, OFFERING_ID, 'coursework'));
  });

  it('differs by component type', () => {
    expect(assessmentComponentId(TENANT_ID, OFFERING_ID, 'coursework'))
      .not.toBe(assessmentComponentId(TENANT_ID, OFFERING_ID, 'exam'));
  });

  it('differs by offering', () => {
    const other = 'b0000000-0000-4000-8000-000000000099';
    expect(assessmentComponentId(TENANT_ID, OFFERING_ID, 'coursework'))
      .not.toBe(assessmentComponentId(TENANT_ID, other, 'coursework'));
  });
});

// ─── generateComponentsForOffering ───────────────────────────────────────────

describe('generateComponentsForOffering', () => {
  const pair = generateComponentsForOffering(TENANT_ID, OFFERING_ID, 'Introduction to Computing', DATE);

  it('coursework weighting is 40', () => {
    expect(pair.coursework.weighting).toBe(40);
  });

  it('exam weighting is 60', () => {
    expect(pair.exam.weighting).toBe(60);
  });

  it('coursework componentTypeCode is "coursework"', () => {
    expect(pair.coursework.componentTypeCode).toBe('coursework');
  });

  it('exam componentTypeCode is "exam"', () => {
    expect(pair.exam.componentTypeCode).toBe('exam');
  });

  it('both reference the correct offering', () => {
    expect(pair.coursework.moduleOfferingId).toBe(OFFERING_ID);
    expect(pair.exam.moduleOfferingId).toBe(OFFERING_ID);
  });

  it('titles include DEMO prefix via module title', () => {
    expect(pair.coursework.title).toContain('Introduction to Computing');
    expect(pair.exam.title).toContain('Introduction to Computing');
  });

  it('IDs are stable', () => {
    const p2 = generateComponentsForOffering(TENANT_ID, OFFERING_ID, 'Introduction to Computing', DATE);
    expect(pair.coursework.id).toBe(p2.coursework.id);
    expect(pair.exam.id).toBe(p2.exam.id);
  });

  it('coursework and exam IDs differ', () => {
    expect(pair.coursework.id).not.toBe(pair.exam.id);
  });
});

// ─── rawMarkForSlot ───────────────────────────────────────────────────────────

describe('rawMarkForSlot', () => {
  it('returns a value between 30 and 85', () => {
    for (let seq = 1; seq <= 200; seq++) {
      for (const slot of [0, 1]) {
        for (const ci of [0, 1]) {
          const m = rawMarkForSlot(seq, slot, ci);
          expect(m).toBeGreaterThanOrEqual(30);
          expect(m).toBeLessThanOrEqual(85);
        }
      }
    }
  });

  it('is stable', () => {
    expect(rawMarkForSlot(42, 0, 0)).toBe(rawMarkForSlot(42, 0, 0));
  });

  it('differs by seq', () => {
    expect(rawMarkForSlot(1, 0, 0)).not.toBe(rawMarkForSlot(2, 0, 0));
  });

  it('produces a mix of pass (>=40) and fail (<40) marks', () => {
    let fails = 0;
    let passes = 0;
    for (let seq = 1; seq <= 200; seq++) {
      const m = rawMarkForSlot(seq, 0, 0);
      if (m < 40) fails++; else passes++;
    }
    expect(fails).toBeGreaterThan(0);
    expect(passes).toBeGreaterThan(fails);
  });
});

// ─── generateMark ─────────────────────────────────────────────────────────────

describe('generateMark', () => {
  const componentId = assessmentComponentId(TENANT_ID, OFFERING_ID, 'exam');
  const mark        = generateMark(TENANT_ID, REG_ID, componentId, 10, 0, 1, DATE);

  it('has the correct moduleRegistrationId', () => {
    expect(mark.moduleRegistrationId).toBe(REG_ID);
  });

  it('has the correct assessmentComponentId', () => {
    expect(mark.assessmentComponentId).toBe(componentId);
  });

  it('rawMark and adjustedMark are equal (no penalty)', () => {
    expect(mark.rawMark).toBe(mark.adjustedMark);
  });

  it('penaltyApplied is false', () => {
    expect(mark.penaltyApplied).toBe(false);
  });

  it('sourceSystem is "vle"', () => {
    expect(mark.sourceSystem).toBe('vle');
  });

  it('attemptNumber is 1', () => {
    expect(mark.attemptNumber).toBe(1);
  });

  it('locked is false', () => {
    expect(mark.locked).toBe(false);
  });

  it('id and versionId are the same deterministic value', () => {
    expect(mark.id).toBe(mark.versionId);
  });

  it('is stable across calls', () => {
    const m2 = generateMark(TENANT_ID, REG_ID, componentId, 10, 0, 1, DATE);
    expect(mark.id).toBe(m2.id);
  });
});

// ─── generateModuleResult ─────────────────────────────────────────────────────

describe('generateModuleResult', () => {
  it('aggregates marks as 40% cw + 60% exam', () => {
    const r = generateModuleResult(TENANT_ID, REG_ID, 50, 70, DATE);
    expect(r.aggregateMark).toBe(String(Math.round(50 * 0.4 + 70 * 0.6)));
  });

  it('resultCode is "pass" when aggregate >= 40', () => {
    const r = generateModuleResult(TENANT_ID, REG_ID, 40, 40, DATE);
    expect(r.resultCode).toBe('pass');
  });

  it('resultCode is "compensated" when aggregate is 35–39', () => {
    const r = generateModuleResult(TENANT_ID, REG_ID, 30, 40, DATE);
    // aggregate = 30*0.4 + 40*0.6 = 12 + 24 = 36 → compensated
    expect(r.resultCode).toBe('compensated');
  });

  it('resultCode is "fail" when aggregate < 35', () => {
    const r = generateModuleResult(TENANT_ID, REG_ID, 30, 30, DATE);
    expect(r.resultCode).toBe('fail');
  });

  it('locked is false', () => {
    const r = generateModuleResult(TENANT_ID, REG_ID, 60, 70, DATE);
    expect(r.locked).toBe(false);
  });

  it('id equals versionId', () => {
    const r = generateModuleResult(TENANT_ID, REG_ID, 60, 70, DATE);
    expect(r.id).toBe(r.versionId);
  });
});

// ─── getModuleOfferingsForYear ────────────────────────────────────────────────

describe('getModuleOfferingsForYear', () => {
  const offerings = getModuleOfferingsForYear(TENANT_ID, YEAR);

  it('returns a non-empty list', () => {
    expect(offerings.length).toBeGreaterThan(0);
  });

  it('all offering IDs are valid UUIDs', () => {
    for (const o of offerings) {
      expect(o.offeringId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    }
  });

  it('contains both AUTUMN and SPRING terms', () => {
    const terms = new Set(offerings.map(o => o.termCode));
    expect(terms.has('AUTUMN')).toBe(true);
    expect(terms.has('SPRING')).toBe(true);
  });

  it('all offering IDs are unique', () => {
    const ids = offerings.map(o => o.offeringId);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

// ─── VLE helpers ──────────────────────────────────────────────────────────────

describe('buildVleRegistration', () => {
  const CONTRACT_ID = 'c0000000-0000-4000-8000-000000000001';
  const reg = buildVleRegistration(TENANT_ID, CONTRACT_ID);

  it('id is stable', () => {
    expect(reg.id).toBe(buildVleRegistration(TENANT_ID, CONTRACT_ID).id);
  });

  it('enabled is true', () => {
    expect(reg.enabled).toBe(true);
  });

  it('displayName contains DEMO', () => {
    expect(reg.displayName).toContain('DEMO');
  });

  it('transportCode is "api"', () => {
    expect(reg.transportCode).toBe('api');
  });
});

describe('buildVleExchange', () => {
  const REG_ID_VLE = 'c0000000-0000-4000-8000-000000000002';
  const ex = buildVleExchange(TENANT_ID, REG_ID_VLE, REG_ID, OFFERING_ID, 5, DATE);

  it('contractId is "vle-assessment-results.v1"', () => {
    expect(ex.contractId).toBe('vle-assessment-results.v1');
  });

  it('directionCode is "inbound"', () => {
    expect(ex.directionCode).toBe('inbound');
  });

  it('statusCode is "completed" for non-failed seqs', () => {
    expect(ex.statusCode).toBe('completed');
  });

  it('statusCode is "failed" for seq % 20 === 0', () => {
    const failed = buildVleExchange(TENANT_ID, REG_ID_VLE, REG_ID, OFFERING_ID, 20, DATE);
    expect(failed.statusCode).toBe('failed');
  });
});

// ─── Wellbeing generators ─────────────────────────────────────────────────────

describe('wellbeing hasWellbeingCase', () => {
  it('returns true for seq % 50 === 0', () => {
    expect(hasWellbeingCase(50)).toBe(true);
    expect(hasWellbeingCase(100)).toBe(true);
  });

  it('returns false otherwise', () => {
    expect(hasWellbeingCase(1)).toBe(false);
    expect(hasWellbeingCase(51)).toBe(false);
  });

  it('produces ~20 cases for 1,000 students', () => {
    let count = 0;
    for (let i = 1; i <= 1_000; i++) {
      if (hasWellbeingCase(i)) count++;
    }
    expect(count).toBe(20);
  });
});

describe('hasMentalHealthCase', () => {
  it('returns true for seq % 350 === 0', () => {
    expect(hasMentalHealthCase(350)).toBe(true);
    expect(hasMentalHealthCase(700)).toBe(true);
  });
});

describe('hasEcClaim', () => {
  it('returns true for seq % 200 === 0', () => {
    expect(hasEcClaim(200)).toBe(true);
    expect(hasEcClaim(400)).toBe(true);
  });
});

describe('generateWellbeingCase', () => {
  const wc = generateWellbeingCase(TENANT_ID, PERSON_ID, 50);

  it('caseRef starts with DEMO-WB-', () => {
    expect(wc.caseRef).toMatch(/^DEMO-WB-/);
  });

  it('statusCode is "active"', () => {
    expect(wc.statusCode).toBe('active');
  });

  it('notes contains DEMO prefix', () => {
    expect(wc.notes).toContain('DEMO - ');
  });

  it('id is stable', () => {
    expect(wc.id).toBe(generateWellbeingCase(TENANT_ID, PERSON_ID, 50).id);
  });
});

describe('generateDisabilitySupportCase', () => {
  const dc = generateDisabilitySupportCase(TENANT_ID, PERSON_ID, 50);

  it('versionId equals id (first version)', () => {
    expect(dc.versionId).toBe(dc.id);
  });

  it('statusCode is "active"', () => {
    expect(dc.statusCode).toBe('active');
  });

  it('dsaAwardRef starts with DEMO-DSA-', () => {
    expect(dc.dsaAwardRef).toMatch(/^DEMO-DSA-/);
  });

  it('wellbeingCaseId matches wellbeingCaseId helper', () => {
    expect(dc.wellbeingCaseId).toBe(wellbeingCaseId(TENANT_ID, 50));
  });
});

describe('generateAdjustmentCase', () => {
  const ac = generateAdjustmentCase(TENANT_ID, PERSON_ID, 50);

  it('statusCode is "approved"', () => {
    expect(ac.statusCode).toBe('approved');
  });

  it('recommendedAdjustment contains DEMO prefix', () => {
    expect(ac.recommendedAdjustment).toContain('DEMO - ');
  });

  it('disabilitySupportCaseId matches disabilityCaseId helper', () => {
    expect(ac.disabilitySupportCaseId).toBe(disabilityCaseId(TENANT_ID, 50));
  });
});

describe('generateMentalHealthCase', () => {
  const mh = generateMentalHealthCase(TENANT_ID, PERSON_ID, 350);

  it('consentGiven is true', () => {
    expect(mh.consentGiven).toBe(true);
  });

  it('riskLevelCode is "low"', () => {
    expect(mh.riskLevelCode).toBe('low');
  });

  it('presentingConcernCode is one of the valid values', () => {
    expect(['anxiety', 'depression', 'other']).toContain(mh.presentingConcernCode);
  });
});

describe('generateEcClaim', () => {
  const ec = generateEcClaim(TENANT_ID, PERSON_ID, ENROL_ID, 200);

  it('enrolmentId is set correctly', () => {
    expect(ec.enrolmentId).toBe(ENROL_ID);
  });

  it('circumstancesNarrative contains DEMO prefix', () => {
    expect(ec.circumstancesNarrative).toContain('DEMO - ');
  });

  it('statusCode is one of the valid values', () => {
    expect(['upheld', 'not_upheld', 'under_review']).toContain(ec.statusCode);
  });

  it('affectedModuleCodes is an array', () => {
    expect(Array.isArray(ec.affectedModuleCodes)).toBe(true);
  });
});

// ─── S4 story markers ─────────────────────────────────────────────────────────

describe('S4 story markers', () => {
  it('all three S4 markers are defined', () => {
    expect(STORY_MARKERS.S4_ALICE_MARKED).toBeDefined();
    expect(STORY_MARKERS.S4_BOB_EC_CLAIM).toBeDefined();
    expect(STORY_MARKERS.S4_CAROL_ADJUSTMENT).toBeDefined();
  });

  it('S4 marker values are unique', () => {
    const s4 = [
      STORY_MARKERS.S4_ALICE_MARKED,
      STORY_MARKERS.S4_BOB_EC_CLAIM,
      STORY_MARKERS.S4_CAROL_ADJUSTMENT,
    ];
    expect(new Set(s4).size).toBe(3);
  });
});
