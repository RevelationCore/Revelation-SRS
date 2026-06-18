import type {
  FeatureFlag,
  FeatureFlagAssignment,
  FeatureFlagVariant,
  NewAcademicRule,
} from '@revelation-srs/db';

import { deterministicId } from './ids.js';

// ─── ID helpers ───────────────────────────────────────────────────────────────

export function academicRuleId(tenantId: string, ruleTypeCode: string, ruleKey: string): string {
  return deterministicId('academic-rule', tenantId, ruleTypeCode, ruleKey);
}

export function featureFlagId(flagKey: string): string {
  return deterministicId('feature-flag', flagKey);
}

export function featureFlagVariantId(flagKey: string, variantKey: string): string {
  return deterministicId('feature-flag-variant', flagKey, variantKey);
}

export function featureFlagAssignmentId(flagKey: string, tenantId: string): string {
  return deterministicId('feature-flag-assignment', flagKey, tenantId);
}

// ─── Academic rules ───────────────────────────────────────────────────────────

/**
 * Baseline academic rules for a demo tenant.
 *
 * Covers the minimum rule set required for the assessments, boards, and
 * progression checks exercised by the demo scenarios:
 *   - pass/fail thresholds
 *   - compensation limits
 *   - resit cap
 *   - credit accumulation for progression
 *   - award classification boundaries
 */
export function generateAcademicRules(tenantId: string): NewAcademicRule[] {
  const validFrom  = new Date('2020-08-01T00:00:00Z');
  const recordedAt = validFrom;

  const rule = (
    ruleTypeCode: string,
    ruleKey:      string,
    ruleValue:    Record<string, unknown>,
    description?: string,
    appliesToLevel?: number,
  ): NewAcademicRule => ({
    id:             academicRuleId(tenantId, ruleTypeCode, ruleKey),
    tenantId,
    validFrom,
    recordedAt,
    programmeId:    null,
    ruleTypeCode,
    ruleKey,
    ruleValue,
    description:    description ?? null,
    appliesToLevel: appliesToLevel ?? null,
  });

  return [
    // Pass mark thresholds (FHEQ levels 4–7)
    rule('PASS_MARK', 'undergraduate',     { mark: 40 }, 'Minimum pass mark for UG modules'),
    rule('PASS_MARK', 'postgraduate',      { mark: 50 }, 'Minimum pass mark for PG modules'),

    // Compensation — maximum credits that can be condoned below the pass mark
    rule('COMPENSATION', 'max_credits',    { credits: 30 }, 'Max credits compensatable per year'),
    rule('COMPENSATION', 'min_mark',       { mark: 30 },   'Minimum mark to qualify for compensation'),

    // Resit cap
    rule('RESIT', 'max_attempts',          { attempts: 2 }, 'Maximum resit attempts per module'),
    rule('RESIT', 'capped_at',             { mark: 40 },    'Resit results capped at pass mark'),

    // Progression (credits required to proceed to next level)
    rule('PROGRESSION', 'level_4_to_5',   { minCredits: 100 }, 'Credits required to progress L4→L5', 4),
    rule('PROGRESSION', 'level_5_to_6',   { minCredits: 100 }, 'Credits required to progress L5→L6', 5),
    rule('PROGRESSION', 'level_6_to_award', { minCredits: 100 }, 'Credits required for award L6',    6),
    rule('PROGRESSION', 'level_6_to_7',   { minCredits: 100 }, 'Credits required to progress L6→L7', 6),
    rule('PROGRESSION', 'level_7_to_award', { minCredits: 160 }, 'Credits required for PG award',    7),

    // Award classification (honours degree)
    rule('CLASSIFICATION', 'first',          { minAvg: 70 }, 'First class honours threshold'),
    rule('CLASSIFICATION', 'upper_second',   { minAvg: 60 }, 'Upper second class honours threshold'),
    rule('CLASSIFICATION', 'lower_second',   { minAvg: 50 }, 'Lower second class honours threshold'),
    rule('CLASSIFICATION', 'third',          { minAvg: 40 }, 'Third class honours threshold'),

    // PG classification
    rule('CLASSIFICATION', 'pg_distinction', { minAvg: 70 }, 'PG distinction threshold'),
    rule('CLASSIFICATION', 'pg_merit',       { minAvg: 60 }, 'PG merit threshold'),
    rule('CLASSIFICATION', 'pg_pass',        { minAvg: 50 }, 'PG pass threshold'),

    // Exam board quorum
    rule('BOARD', 'quorum_minimum',          { percent: 66 }, 'Minimum percentage of board members required'),
    rule('BOARD', 'ratification_window_days', { days: 14 }, 'Days after board meeting to ratify results'),

    // Extenuating circumstances
    rule('EC', 'submission_deadline_days', { days: 10 }, 'Days after assessment to submit EC claim'),
    rule('EC', 'max_deferrals',            { count: 2 }, 'Maximum assessment deferrals per year'),
  ];
}

// ─── Feature flags ────────────────────────────────────────────────────────────

export interface FeatureFlagData {
  flags:       Omit<FeatureFlag,    'createdAt' | 'updatedAt'>[];
  variants:    Omit<FeatureFlagVariant, 'createdAt'>[];
  assignments: Omit<FeatureFlagAssignment, 'createdAt' | 'updatedAt'>[];
}

interface FlagSpec {
  flagKey:      string;
  displayName:  string;
  description?: string;
  module:       string;
  enabledFor?:  string[];  // tenant IDs to enable this flag for (empty = disabled everywhere)
}

const FLAG_SPECS: FlagSpec[] = [
  {
    flagKey:     'demo.wellbeing.enhanced-support-plans',
    displayName: 'Enhanced Support Plan UI',
    description: 'Shows extended field set on student support plan forms.',
    module:      'wellbeing',
  },
  {
    flagKey:     'demo.boards.digital-ratification',
    displayName: 'Digital Board Ratification',
    description: 'Enables paperless board ratification with audit signature capture.',
    module:      'governance',
  },
  {
    flagKey:     'demo.vle.two-way-grade-sync',
    displayName: 'VLE Two-Way Grade Sync',
    description: 'Syncs grades bidirectionally between SRS and the connected VLE.',
    module:      'integration',
  },
  {
    flagKey:     'demo.portal.student-self-service',
    displayName: 'Student Self-Service Portal',
    description: 'Enables the student-facing portal features in the demo environment.',
    module:      'portal',
  },
  {
    flagKey:     'demo.admin.bulk-operations',
    displayName: 'Admin Bulk Operations',
    description: 'Enables bulk enrolment/withdrawal tools in the admin interface.',
    module:      'admin',
  },
];

/**
 * Generate feature flags and tenant-scoped assignments for a demo tenant.
 *
 * All flags default to OFF globally; the function creates an 'on' variant
 * assignment scoped to the given tenant for each flag in FLAG_SPECS.
 */
export function generateFeatureFlags(tenantId: string): FeatureFlagData {
  const flags: FeatureFlagData['flags']       = [];
  const variants: FeatureFlagData['variants'] = [];
  const assignments: FeatureFlagData['assignments'] = [];

  for (const spec of FLAG_SPECS) {
    const fId     = featureFlagId(spec.flagKey);
    const offVId  = featureFlagVariantId(spec.flagKey, 'off');
    const onVId   = featureFlagVariantId(spec.flagKey, 'on');

    flags.push({
      id:                  fId,
      flagKey:             spec.flagKey,
      displayName:         `DEMO - ${spec.displayName}`,
      description:         spec.description ?? null,
      ownerModuleCode:     spec.module,
      statusCode:          'active',
      valueTypeCode:       'boolean',
      defaultVariantKey:   'off',
      createdBy:           'demo-data',
      flagClassCode:       'release',
      riskClassCode:       'low',
      ownerContact:        null,
      reviewDate:          null,
      retirementCondition: null,
      allowedScopeCodes:   ['global', 'tenant', 'environment'],
      nonBypassable:       false,
    });

    variants.push(
      {
        id:          offVId,
        flagId:      fId,
        variantKey:  'off',
        displayName: 'Off',
        value:       false,
        sortOrder:   0,
      },
      {
        id:          onVId,
        flagId:      fId,
        variantKey:  'on',
        displayName: 'On',
        value:       true,
        sortOrder:   1,
      },
    );

    // Create a tenant-scoped 'on' assignment for this demo tenant
    assignments.push({
      id:                          featureFlagAssignmentId(spec.flagKey, tenantId),
      tenantId,
      environmentId:               null,
      flagId:                      fId,
      variantId:                   onVId,
      workflowDefinitionVersionId: null,
      roleCode:                    null,
      cohortCode:                  null,
      programmeId:                 null,
      academicYear:                null,
      sourceSystemCode:            null,
      priority:                    50,
      statusCode:                  'active',
      ruleExpression:              null,
      configuration:               {},
      activeFrom:                  new Date('2020-08-01T00:00:00Z'),
      activeTo:                    null,
      createdBy:                   'demo-data',
    });
  }

  return { flags, variants, assignments };
}
