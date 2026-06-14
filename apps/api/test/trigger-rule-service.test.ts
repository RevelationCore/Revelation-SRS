import { describe, expect, it } from 'vitest';

import type { CreateEnrolmentInput, EnrolmentDto } from '../src/platform/enrolment/service.js';
import {
  evaluateConfiguredEnrolmentTriggers,
  evaluateLegacyEnrolmentCreationTriggers,
  evaluateLegacyEnrolmentStatusTransitionTriggers,
  type ConfiguredRule,
} from '../src/platform/workflow/trigger-rule-service.js';

const enrolmentInput: CreateEnrolmentInput = {
  personId: '11111111-1111-1111-1111-111111111111',
  modeOfStudyCode: 'full-time',
  academicYearOfEntry: '2026/27',
  startDate: '2026-09-21',
  fundingSourceCode: 'slc',
  slcReference: 'SLC-123',
  ucasPersonalId: 'UCAS-456',
  ukviCasRequired: true,
};

const currentEnrolment: EnrolmentDto = {
  enrolmentId: '22222222-2222-2222-2222-222222222222',
  personId: enrolmentInput.personId,
  programmeId: null,
  statusCode: 'enrolled',
  modeOfStudyCode: 'full-time',
  attendanceTypeCode: null,
  academicYearOfEntry: '2026/27',
  startDate: '2026-09-21',
  expectedEndDate: null,
  actualEndDate: null,
  feeBandCode: null,
  fundingSourceCode: 'slc',
  slcReference: 'SLC-123',
  ucasPersonalId: 'UCAS-456',
  validFrom: new Date('2026-09-21T00:00:00.000Z'),
  recordedAt: new Date('2026-09-21T00:00:00.000Z'),
};

const configuredCreationRules: ConfiguredRule[] = [
  {
    triggerKey: 'enrolment-created-ucas-confirmation',
    eventType: 'enrolment.created',
    targetWorkflowCode: 'ucas-confirmation',
    conditionExpression: 'ucasPersonalId.present',
    configuration: {},
    active: true,
  },
  {
    triggerKey: 'enrolment-created-slc-confirmation',
    eventType: 'enrolment.created',
    targetWorkflowCode: 'slc-confirmation',
    conditionExpression: 'slcFundingOrReference.present',
    configuration: {},
    active: true,
  },
];

describe('enrolment trigger rule evaluation', () => {
  it('preserves legacy creation triggers with evaluation evidence', () => {
    const decisions = evaluateLegacyEnrolmentCreationTriggers(enrolmentInput);

    expect(decisions.map((decision) => decision.triggerTypeCode)).toEqual([
      'ucas-confirmation',
      'slc-confirmation',
      'ukvi-cas',
    ]);
    expect(decisions[0]?.payloadSummary.triggerRule).toMatchObject({
      mode: 'legacy',
      ruleKey: 'legacy.ucas-confirmation-on-ucas-id',
      ruleSource: 'legacy-code',
    });
  });

  it('preserves legacy SLC status-change trigger behavior', () => {
    const decisions = evaluateLegacyEnrolmentStatusTransitionTriggers({
      current: currentEnrolment,
      newStatus: 'withdrawn',
    });

    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toMatchObject({
      triggerTypeCode: 'slc-confirmation',
      sourceReference: 'SLC-123',
    });
    expect(decisions[0]?.payloadSummary).toMatchObject({
      slcReference: 'SLC-123',
      notificationType: 'withdrawn',
      triggerRule: {
        mode: 'legacy',
        ruleKey: 'legacy.slc-status-change-on-withdrawal-or-intermission',
      },
    });
  });

  it('allows configured mode to disable a trigger by omitting its active rule', () => {
    const decisions = evaluateConfiguredEnrolmentTriggers(
      'enrolment.created',
      enrolmentInput,
      configuredCreationRules,
    );

    expect(decisions.map((decision) => decision.triggerTypeCode)).toEqual([
      'ucas-confirmation',
      'slc-confirmation',
    ]);
    expect(decisions.every((decision) => decision.evidence.mode === 'configured')).toBe(true);
  });

  it('allows configured rules to redirect non-production endpoint metadata', () => {
    const decisions = evaluateConfiguredEnrolmentTriggers('enrolment.created', enrolmentInput, [
      {
        triggerKey: 'enrolment-created-ucas-test-endpoint',
        eventType: 'enrolment.created',
        targetWorkflowCode: 'ucas-confirmation',
        conditionExpression: 'ucasPersonalId.present',
        configuration: {
          payloadSummaryOverrides: {
            endpointCode: 'ucas-test-sandbox',
          },
        },
        active: true,
      },
    ]);

    expect(decisions).toHaveLength(1);
    expect(decisions[0]?.payloadSummary).toMatchObject({
      endpointCode: 'ucas-test-sandbox',
      triggerRule: {
        mode: 'configured',
        ruleKey: 'enrolment-created-ucas-test-endpoint',
        ruleSource: 'workflow-trigger-rule',
        conditionExpression: 'ucasPersonalId.present',
      },
    });
  });
});
