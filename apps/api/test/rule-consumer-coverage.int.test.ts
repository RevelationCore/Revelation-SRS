import { randomUUID } from 'node:crypto';

import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { RULE_TYPE_DOMAIN, type RuleTypeCode } from '../src/platform/rules-engine/engine.js';

import { startTestApp, type TestApp } from './helpers/test-app.js';

/**
 * Phase 5 D-35: every calculation records the exact rule versions it used.
 * For every rule type outside module selection (D-23 covers those), a
 * distinctive rule is configured and some calculation must cite that
 * rule's academic_rule version id.
 */
let ctx: TestApp;
let staff: string;
let admin: string;

interface Citation { ruleTypeCode: string; versionId: string | null; source: string; value: unknown }

beforeAll(async () => {
  ctx = await startTestApp();
  staff = await ctx.makeJwt();
  admin = await ctx.makeJwt({ roles: ['tenant-administrator'] });
}, 120_000);

afterAll(async () => { await ctx?.teardown(); });

async function call<T>(method: 'GET' | 'POST' | 'PATCH', url: string, payload?: unknown, token = staff): Promise<T> {
  const res = await ctx.app.inject({ method, url, headers: { authorization: `Bearer ${token}` }, ...(payload !== undefined ? { payload: payload as Record<string, unknown> } : {}) });
  expect(res.statusCode, `${method} ${url}: ${res.body}`).toBeLessThan(300);
  return res.json<T>();
}

async function row<T>(query: ReturnType<typeof sql>): Promise<T> {
  return (await ctx.db.execute(query) as unknown as T[])[0]!;
}

const NON_SELECTION = (Object.keys(RULE_TYPE_DOMAIN) as RuleTypeCode[]).filter((t) => RULE_TYPE_DOMAIN[t] !== 'selection');

/** A distinctive configured rule for each non-selection type. */
const RULES: Record<string, [string, Record<string, unknown>, 'programme' | 'tenant']> = {
  'pass-mark':                      ['undergraduate-default', { mark: 41 }, 'programme'],
  'late-penalty-rate':              ['default', { percentPerDay: 5 }, 'programme'],
  'late-penalty-cap':               ['default', { maxPenaltyPercent: 7 }, 'programme'],
  'resit-mark-cap':                 ['default', { cap: 45 }, 'programme'],
  'compensation-threshold':         ['default', { minimumMark: 30 }, 'programme'],
  'compensation-credit-limit':      ['default', { maxCredits: 20 }, 'programme'],
  'condonement-threshold':          ['default', { minimumMark: 25 }, 'programme'],
  'progression-credit-requirement': ['default', { requiredCredits: 20 }, 'programme'],
  'progression-pass-requirement':   ['default', { minimumModulePasses: 1 }, 'programme'],
  'classification-boundary':        ['undergraduate', { boundaries: [{ code: 'first', minimumMark: 71 }, { code: 'upper-second', minimumMark: 61 }, { code: 'lower-second', minimumMark: 51 }, { code: 'third', minimumMark: 41 }] }, 'programme'],
  'classification-algorithm':       ['undergraduate', { algorithm: 'weighted-average' }, 'programme'],
  'classification-discretion-zone': ['undergraduate', { widthPercent: 2 }, 'programme'],
  'award-credit-requirement':       ['default', { requiredCredits: 20 }, 'programme'],
  'ukvi-attendance-threshold':      ['default', { maxUnauthorisedAbsences: 3 }, 'tenant'],
};

describe('Rule consumer coverage (Phase 5 D-35)', () => {
  const versionOf = new Map<string, string>();
  const cited: Citation[] = [];
  let enrolmentId = '';

  beforeAll(async () => {
    const { programmeId } = await call<{ programmeId: string }>('POST', '/api/v1/programmes', { code: 'RCC', title: 'Rule coverage', fheqLevel: 6, creditTotal: 360 });
    for (const [type, [key, value, scope]] of Object.entries(RULES)) {
      await call('POST', '/api/v1/academic-rules', {
        ...(scope === 'programme' ? { programmeId } : {}), ruleTypeCode: type, ruleKey: key, ruleValue: value, validFrom: '2020-01-01T00:00:00.000Z',
      }, admin);
      const r = await row<{ version_id: string }>(sql`SELECT version_id FROM academic_rule WHERE rule_type_code = ${type} AND recorded_until IS NULL
        AND ${scope === 'programme' ? sql`programme_id = ${programmeId}::uuid` : sql`programme_id IS NULL`}`);
      versionOf.set(type, r.version_id);
    }
    // Late penalties and resit caps apply only when the tenant turns them on.
    await ctx.db.execute(sql`
      INSERT INTO feature_flag_assignment (tenant_id, flag_id, variant_id, status_code, priority, created_by)
      SELECT ${ctx.tenantId}::uuid, f.id, v.id, 'active', 10, 'test'
      FROM feature_flag f JOIN feature_flag_variant v ON v.flag_id = f.id AND v.variant_key = 'on'
      WHERE f.flag_key IN ('assessment.resit-cap.enabled', 'assessment.late-penalty.enabled')`);

    const { personId } = await call<{ personId: string }>('POST', '/api/v1/students', { legalFirstName: 'Rule', legalFamilyName: 'Coverage' });
    ({ enrolmentId } = await call<{ enrolmentId: string }>('POST', '/api/v1/enrolments', {
      personId, programmeId, modeOfStudyCode: 'full-time', academicYearOfEntry: '2027-28', startDate: '2027-09-20',
    }));
    const { academicPeriodId } = await call<{ academicPeriodId: string }>('POST', '/api/v1/academic-periods', {
      academicYear: '2027-28', periodCode: 'RCC-SEM1', periodTypeCode: 'semester', startDate: '2027-09-20', endDate: '2028-01-14',
    });

    // Assessment: a late first attempt (penalty rate and cap) and a capped resit, then the module result (pass mark).
    const { moduleId } = await call<{ moduleId: string }>('POST', '/api/v1/modules', { code: 'RCC-M1', title: 'Rules', creditValue: 20 });
    const { moduleOfferingId } = await call<{ moduleOfferingId: string }>('POST', '/api/v1/module-offerings', { moduleId, academicPeriodId, deliveryModeCode: 'in-person', capacity: 10 });
    const { moduleRegistrationId } = await call<{ moduleRegistrationId: string }>('POST', '/api/v1/module-registrations', { enrolmentId, moduleOfferingId, registrationDate: '2027-10-01' });
    const { assessmentComponentId } = await call<{ assessmentComponentId: string }>('POST', `/api/v1/module-offerings/${moduleOfferingId}/components`, { componentTypeCode: 'coursework', title: 'Essay', weighting: 100 });
    await call('POST', `/api/v1/module-registrations/${moduleRegistrationId}/marks`, {
      assessmentComponentId, rawMark: 60, attemptNumber: 1, dueAt: '2027-12-01T12:00:00.000Z', submittedAt: '2027-12-03T12:00:00.000Z',
    });
    await call('POST', `/api/v1/module-registrations/${moduleRegistrationId}/marks`, { assessmentComponentId, rawMark: 80, attemptNumber: 2 });
    const marks = await ctx.db.execute(sql`SELECT rule_versions FROM mark WHERE module_registration_id = ${moduleRegistrationId}::uuid AND recorded_until IS NULL`) as unknown as Array<{ rule_versions: Citation[] }>;
    for (const m of marks) cited.push(...m.rule_versions);
    cited.push(...(await call<{ ruleVersions: Citation[] }>('GET', `/api/v1/module-registrations/${moduleRegistrationId}/result`)).ruleVersions);

    // Progression.
    await call('POST', `/api/v1/enrolments/${enrolmentId}/progression`, { academicYear: '2027-28' });
    const decision = await call<{ progressionDecisionId: string }>('GET', `/api/v1/enrolments/${enrolmentId}/progression?academicYear=2027-28`);
    cited.push(...(await call<{ ruleVersions: Citation[] }>('GET', `/api/v1/progression-decisions/${decision.progressionDecisionId}/evidence`)).ruleVersions);

    // Award: the classification preview.
    cited.push(...(await call<{ ruleVersions: Citation[] }>('GET', `/api/v1/enrolments/${enrolmentId}/classification`)).ruleVersions);

    // Regulatory: an attendance breach raises a UKVI compliance alert.
    await ctx.db.execute(sql`
      INSERT INTO ukvi_attendance_report (id, tenant_id, academic_period_id, submitted_at, report_payload, submitted_by)
      VALUES (${randomUUID()}, ${ctx.tenantId}, ${academicPeriodId}, NOW(), ${JSON.stringify({
        academicPeriodId, generatedAt: new Date().toISOString(), studentCount: 1, _attendance_data_completeness: 'provided',
        students: [{ enrolmentId, casReference: 'CAS-RCC-1', absenceCount: 4 }],
      })}::jsonb, 'test-user')`);
    expect((await call<{ alertsRaised: number }>('POST', '/api/v1/regulatory/ukvi/compliance-alerts/evaluate')).alertsRaised).toBe(1);
    const alert = await row<{ rule_versions: Citation[] }>(sql`SELECT rule_versions FROM ukvi_compliance_alert WHERE enrolment_id = ${enrolmentId}::uuid`);
    cited.push(...alert.rule_versions);
  }, 120_000);

  it('classifies every rule type it covers', () => {
    expect(Object.keys(RULES).sort()).toEqual([...NON_SELECTION].sort());
  });

  it.each(NON_SELECTION)('a calculation cites the configured %s version', (type) => {
    const versionId = versionOf.get(type)!;
    expect(cited.find((c) => c.ruleTypeCode === type && c.versionId === versionId), `${type} version ${versionId} not cited`).toBeDefined();
  });
});

describe('Built-in defaults (D-35)', () => {
  it('refuses built-in defaults unless the tenant allows them, or is a demo tenant (BL-179)', async () => {
    // A tenant as a real institution starts: no rules configured, no setting.
    const tenantId = randomUUID();
    await ctx.db.execute(sql`INSERT INTO tenant (id, code, name, active) VALUES (${tenantId}, 'BL179', 'Unconfigured University', true)`);
    const t = await ctx.makeJwt({ tenantId });
    const tAdmin = await ctx.makeJwt({ tenantId, roles: ['tenant-administrator'] });
    const { personId } = await call<{ personId: string }>('POST', '/api/v1/students', { legalFirstName: 'Default', legalFamilyName: 'Rules' }, t);
    const { enrolmentId } = await call<{ enrolmentId: string }>('POST', '/api/v1/enrolments', {
      personId, modeOfStudyCode: 'full-time', academicYearOfEntry: '2027-28', startDate: '2027-09-20',
    }, t);
    const classify = () => ctx.app.inject({ method: 'GET', url: `/api/v1/enrolments/${enrolmentId}/classification`, headers: { authorization: `Bearer ${t}` } });
    const expectRefused = async () => {
      const refused = await classify();
      expect(refused.statusCode).toBe(422);
      expect(refused.json<{ detail: string }>().detail).toMatch(/built-in defaults refused/);
    };
    const expectBuiltIn = async () => {
      const res = await classify();
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json<{ ruleVersions: Citation[] }>().ruleVersions.find((c) => c.ruleTypeCode === 'classification-boundary'))
        .toMatchObject({ source: 'built-in-default', versionId: null });
    };

    await expectRefused();                       // the default for a real tenant

    await call('PATCH', '/api/v1/tenant/configuration', { rules: { builtInDefaults: 'allow' } }, tAdmin);
    await expectBuiltIn();                       // allowed explicitly, and recorded as built-in

    await call('PATCH', '/api/v1/tenant/configuration', { rules: { builtInDefaults: 'refuse' } }, tAdmin);
    await expectRefused();

    // A demo tenant allows them unless it says otherwise.
    await ctx.db.execute(sql`UPDATE tenant SET demo_mode = true, configuration = configuration #- '{rules,builtInDefaults}' WHERE id = ${tenantId}`);
    await expectBuiltIn();
    await call('PATCH', '/api/v1/tenant/configuration', { rules: { builtInDefaults: 'refuse' } }, tAdmin);
    await expectRefused();
  });

  it('a progression decision whose evidence cannot be written is not recorded', async () => {
    const { personId } = await call<{ personId: string }>('POST', '/api/v1/students', { legalFirstName: 'Evidence', legalFamilyName: 'Failure' });
    const { enrolmentId } = await call<{ enrolmentId: string }>('POST', '/api/v1/enrolments', {
      personId, modeOfStudyCode: 'full-time', academicYearOfEntry: '2027-28', startDate: '2027-09-20',
    });
    await ctx.db.execute(sql`ALTER TABLE progression_calculation_evidence RENAME TO progression_calculation_evidence_off`);
    try {
      const res = await ctx.app.inject({ method: 'POST', url: `/api/v1/enrolments/${enrolmentId}/progression`, headers: { authorization: `Bearer ${staff}` }, payload: { academicYear: '2027-28' } });
      expect(res.statusCode).toBeGreaterThanOrEqual(500);
    } finally {
      await ctx.db.execute(sql`ALTER TABLE progression_calculation_evidence_off RENAME TO progression_calculation_evidence`);
    }
    const n = await row<{ n: string }>(sql`SELECT count(*) AS n FROM progression_decision WHERE enrolment_id = ${enrolmentId}::uuid`);
    expect(Number(n.n)).toBe(0);
  });
});

describe('Reassessment mark cap on repeat results (D-43b)', () => {
  it('caps a repeat registration at its plan cap, and says so in the result', async () => {
    const { personId } = await call<{ personId: string }>('POST', '/api/v1/students', { legalFirstName: 'Repeat', legalFamilyName: 'Capped' });
    const { enrolmentId } = await call<{ enrolmentId: string }>('POST', '/api/v1/enrolments', {
      personId, modeOfStudyCode: 'full-time', academicYearOfEntry: '2027-28', startDate: '2027-09-20',
    });
    const { academicPeriodId } = await call<{ academicPeriodId: string }>('POST', '/api/v1/academic-periods', {
      academicYear: '2028-29', periodCode: 'RCAP-SEM1', periodTypeCode: 'semester', startDate: '2028-09-18', endDate: '2029-01-12',
    });
    const { moduleId } = await call<{ moduleId: string }>('POST', '/api/v1/modules', { code: 'RCAP-M1', title: 'Repeated', creditValue: 20 });
    const { moduleOfferingId } = await call<{ moduleOfferingId: string }>('POST', '/api/v1/module-offerings', { moduleId, academicPeriodId, deliveryModeCode: 'in-person', capacity: 10 });
    const { moduleRegistrationId } = await call<{ moduleRegistrationId: string }>('POST', '/api/v1/module-registrations', { enrolmentId, moduleOfferingId, registrationDate: '2028-10-01' });
    const { assessmentComponentId } = await call<{ assessmentComponentId: string }>('POST', `/api/v1/module-offerings/${moduleOfferingId}/components`, { componentTypeCode: 'exam', title: 'Exam', weighting: 100 });
    const planId = randomUUID();
    await ctx.db.execute(sql`
      INSERT INTO reassessment_plan (id, tenant_id, enrolment_id, progression_decision_id, plan_type_code, repeat_module_registration_id, attempt_number, mark_cap, created_by)
      VALUES (${planId}::uuid, ${ctx.tenantId}::uuid, ${enrolmentId}::uuid, ${randomUUID()}::uuid, 'repeat-module', ${moduleRegistrationId}::uuid, 2, 40, 'test')`);

    await call('POST', `/api/v1/module-registrations/${moduleRegistrationId}/marks`, { assessmentComponentId, rawMark: 72 });
    const result = await call<{ aggregateMark: number; resultCode: string; ruleVersions: Array<{ source: string; planId?: string; value: { cap: number; uncappedMark: number } }> }>(
      'GET', `/api/v1/module-registrations/${moduleRegistrationId}/result`);
    expect(result.aggregateMark).toBe(40);
    expect(result.ruleVersions.find((v) => v.source === 'reassessment-plan')).toMatchObject({ planId, value: { cap: 40, uncappedMark: 72 } });
  });
});
