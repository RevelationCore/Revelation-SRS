import { describe, it, expect } from 'vitest';

import { deterministicId } from '../src/generators/ids.js';
import {
  academicPeriodId,
  generateAcademicYear,
  generateMultiYearCalendar,
} from '../src/generators/calendar.js';
import {
  BASELINE_MODULES,
  BASELINE_PROGRAMMES,
  awardingBodyId,
  generateCurriculum,
  moduleId,
  moduleOfferingId,
  programmeId,
} from '../src/generators/curriculum.js';
import {
  generateAcademicRules,
  generateFeatureFlags,
} from '../src/generators/tenant-config.js';

const TENANT = 'demo-tenant-00000000-0000-4000-8000-000000000001';

// ─── deterministicId ─────────────────────────────────────────────────────────

describe('deterministicId', () => {
  it('produces a valid UUID v5 string', () => {
    const id = deterministicId('a', 'b');
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('is stable across calls', () => {
    expect(deterministicId('academic-period', TENANT, '2024-25', 'AUTUMN'))
      .toBe(deterministicId('academic-period', TENANT, '2024-25', 'AUTUMN'));
  });

  it('differs for different inputs', () => {
    expect(deterministicId('academic-period', TENANT, '2024-25', 'AUTUMN'))
      .not.toBe(deterministicId('academic-period', TENANT, '2024-25', 'SPRING'));
  });

  it('differs for different tenant IDs', () => {
    const other = 'other-tenant-00000000-0000-4000-8000-000000000002';
    expect(deterministicId('academic-period', TENANT, '2024-25', 'AUTUMN'))
      .not.toBe(deterministicId('academic-period', other, '2024-25', 'AUTUMN'));
  });
});

// ─── Calendar ─────────────────────────────────────────────────────────────────

describe('generateAcademicYear', () => {
  const periods = generateAcademicYear(TENANT, '2024-25');

  it('generates 3 periods', () => {
    expect(periods).toHaveLength(3);
  });

  it('has the correct period codes', () => {
    const codes = periods.map(p => p.periodCode);
    expect(codes).toEqual(['AUTUMN', 'SPRING', 'SUMMER']);
  });

  it('autumn dates are in the start year', () => {
    const autumn = periods.find(p => p.periodCode === 'AUTUMN')!;
    expect(autumn.startDate).toMatch(/^2024-/);
    expect(autumn.endDate).toMatch(/^2024-/);
  });

  it('spring and summer dates are in the end year', () => {
    const spring = periods.find(p => p.periodCode === 'SPRING')!;
    const summer = periods.find(p => p.periodCode === 'SUMMER')!;
    expect(spring.startDate).toMatch(/^2025-/);
    expect(summer.startDate).toMatch(/^2025-/);
  });

  it('produces stable IDs via academicPeriodId helper', () => {
    const autumn = periods.find(p => p.periodCode === 'AUTUMN')!;
    expect(autumn.id).toBe(academicPeriodId(TENANT, '2024-25', 'AUTUMN'));
  });

  it('end date is after start date for all periods', () => {
    for (const p of periods) {
      expect(new Date(p.endDate) > new Date(p.startDate)).toBe(true);
    }
  });
});

describe('generateMultiYearCalendar', () => {
  it('generates 3 periods per year', () => {
    const periods = generateMultiYearCalendar(TENANT, ['2023-24', '2024-25', '2025-26']);
    expect(periods).toHaveLength(9);
  });

  it('IDs are unique across years', () => {
    const periods = generateMultiYearCalendar(TENANT, ['2023-24', '2024-25']);
    const ids = periods.map(p => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

// ─── Curriculum ───────────────────────────────────────────────────────────────

describe('BASELINE_PROGRAMMES', () => {
  it('has 11 programmes', () => {
    expect(BASELINE_PROGRAMMES).toHaveLength(11);
  });

  it('all titles start with DEMO -', () => {
    for (const p of BASELINE_PROGRAMMES) {
      expect(p.title).toMatch(/^DEMO - /);
    }
  });

  it('codes are unique', () => {
    const codes = BASELINE_PROGRAMMES.map(p => p.code);
    expect(new Set(codes).size).toBe(codes.length);
  });
});

describe('BASELINE_MODULES', () => {
  it('has at least 35 modules', () => {
    expect(BASELINE_MODULES.length).toBeGreaterThanOrEqual(35);
  });

  it('all titles start with DEMO -', () => {
    for (const m of BASELINE_MODULES) {
      expect(m.title).toMatch(/^DEMO - /);
    }
  });

  it('codes are unique', () => {
    const codes = BASELINE_MODULES.map(m => m.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('all FHEQ levels are between 4 and 7', () => {
    for (const m of BASELINE_MODULES) {
      expect(m.level).toBeGreaterThanOrEqual(4);
      expect(m.level).toBeLessThanOrEqual(7);
    }
  });

  it('all term codes are valid', () => {
    for (const m of BASELINE_MODULES) {
      for (const t of m.terms) {
        expect(['AUTUMN', 'SPRING', 'SUMMER']).toContain(t);
      }
    }
  });
});

describe('generateCurriculum', () => {
  const curriculum = generateCurriculum(TENANT, ['2024-25', '2025-26']);

  it('returns 1 awarding body', () => {
    expect(curriculum.awardingBodies).toHaveLength(1);
  });

  it('awarding body name has DEMO - prefix', () => {
    expect(curriculum.awardingBodies[0]!.name).toMatch(/^DEMO - /);
  });

  it('returns correct programme count', () => {
    expect(curriculum.programmes).toHaveLength(BASELINE_PROGRAMMES.length);
  });

  it('returns correct module count', () => {
    expect(curriculum.modules).toHaveLength(BASELINE_MODULES.length);
  });

  it('module offering count matches modules × years × terms', () => {
    // Count expected: sum of (module.terms.length × academicYears.length) for each module
    const expected = BASELINE_MODULES.reduce((n, m) => n + m.terms.length * 2, 0);
    expect(curriculum.moduleOfferings).toHaveLength(expected);
  });

  it('all module offering IDs are unique', () => {
    const ids = curriculum.moduleOfferings.map(o => o.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('programme IDs are stable', () => {
    expect(curriculum.programmes[0]!.id).toBe(
      programmeId(TENANT, BASELINE_PROGRAMMES[0]!.code),
    );
  });

  it('module IDs are stable', () => {
    expect(curriculum.modules[0]!.id).toBe(
      moduleId(TENANT, BASELINE_MODULES[0]!.code),
    );
  });

  it('module offering IDs are stable', () => {
    const firstModule = BASELINE_MODULES[0]!;
    const firstTerm   = firstModule.terms[0]!;
    const offering    = curriculum.moduleOfferings.find(
      o => o.moduleId === moduleId(TENANT, firstModule.code),
    )!;
    expect(offering).toBeDefined();
    expect(offering.id).toBe(
      moduleOfferingId(TENANT, firstModule.code, '2024-25', firstTerm),
    );
  });

  it('awarding body ID is stable', () => {
    expect(curriculum.awardingBodies[0]!.id).toBe(awardingBodyId(TENANT));
  });

  it('returns empty offerings for zero academic years', () => {
    const empty = generateCurriculum(TENANT, []);
    expect(empty.moduleOfferings).toHaveLength(0);
  });
});

// ─── Tenant config ────────────────────────────────────────────────────────────

describe('generateAcademicRules', () => {
  const rules = generateAcademicRules(TENANT);

  it('returns at least 10 rules', () => {
    expect(rules.length).toBeGreaterThanOrEqual(10);
  });

  it('all rules have non-empty ruleTypeCode and ruleKey', () => {
    for (const r of rules) {
      expect(r.ruleTypeCode).toBeTruthy();
      expect(r.ruleKey).toBeTruthy();
    }
  });

  it('all IDs are unique', () => {
    const ids = rules.map(r => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('all IDs are stable across calls', () => {
    const again = generateAcademicRules(TENANT);
    for (let i = 0; i < rules.length; i++) {
      expect(rules[i]!.id).toBe(again[i]!.id);
    }
  });

  it('pass mark rules have numeric mark value', () => {
    const passRules = rules.filter(r => r.ruleTypeCode === 'PASS_MARK');
    expect(passRules.length).toBeGreaterThanOrEqual(2);
    for (const r of passRules) {
      expect(typeof (r.ruleValue)['mark']).toBe('number');
    }
  });
});

describe('generateFeatureFlags', () => {
  const { flags, variants, assignments } = generateFeatureFlags(TENANT);

  it('returns at least 3 flags', () => {
    expect(flags.length).toBeGreaterThanOrEqual(3);
  });

  it('each flag has exactly 2 variants (on/off)', () => {
    expect(variants.length).toBe(flags.length * 2);
  });

  it('each flag has exactly 1 tenant assignment', () => {
    expect(assignments.length).toBe(flags.length);
  });

  it('all flag IDs are unique', () => {
    const ids = flags.map(f => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('all flag display names start with DEMO -', () => {
    for (const f of flags) {
      expect(f.displayName).toMatch(/^DEMO - /);
    }
  });

  it('variant IDs are unique across all variants', () => {
    const ids = variants.map(v => v.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('all assignment variantIds reference an existing variant', () => {
    const variantIds = new Set(variants.map(v => v.id));
    for (const a of assignments) {
      expect(variantIds.has(a.variantId!)).toBe(true);
    }
  });

  it('assignments are stable across calls', () => {
    const again = generateFeatureFlags(TENANT);
    for (let i = 0; i < flags.length; i++) {
      expect(flags[i]!.id).toBe(again.flags[i]!.id);
    }
  });
});
