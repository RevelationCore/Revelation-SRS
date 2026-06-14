import { describe, expect, it } from 'vitest';

import { ForbiddenError } from '@revelation-srs/domain';

import {
  assertActorCanCompleteWorkflowTask,
  selectWorkflowAssignmentRule,
  type WorkflowAssignmentRuleDto,
} from '../src/platform/platform-controls/workflow-responsibility-service.js';

const baseRule: WorkflowAssignmentRuleDto = {
  workflowAssignmentRuleId: '00000000-0000-0000-0000-000000000001',
  tenantId: '10000000-0000-0000-0000-000000000001',
  workflowDefinitionVersionId: '20000000-0000-0000-0000-000000000001',
  stepKey: 'admissions-review',
  ruleKey: 'registry-default',
  priority: 100,
  roleCode: null,
  organisationalUnitCode: null,
  programmeId: null,
  sourceSystemCode: null,
  assigneeRoleCode: 'registry-administrator',
  assigneeExpression: null,
  configuration: {},
  active: true,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
};

describe('workflow responsibility assignment', () => {
  it('supports a registry-led tenant route through the broad default rule', () => {
    const match = selectWorkflowAssignmentRule([baseRule], {
      workflowDefinitionVersionId: baseRule.workflowDefinitionVersionId,
      stepKey: 'admissions-review',
      roleCodes: ['registry-administrator'],
    });

    expect(match?.ruleKey).toBe('registry-default');
    expect(match?.assigneeRoleCode).toBe('registry-administrator');
  });

  it('supports a school-led tenant route through a more specific programme rule', () => {
    const schoolRule: WorkflowAssignmentRuleDto = {
      ...baseRule,
      workflowAssignmentRuleId: '00000000-0000-0000-0000-000000000002',
      ruleKey: 'school-programme-review',
      programmeId: '30000000-0000-0000-0000-000000000001',
      assigneeRoleCode: 'module-tutor',
      createdAt: new Date('2026-01-02T00:00:00.000Z'),
    };

    const match = selectWorkflowAssignmentRule([baseRule, schoolRule], {
      workflowDefinitionVersionId: baseRule.workflowDefinitionVersionId,
      stepKey: 'admissions-review',
      roleCodes: ['registry-administrator'],
      programmeId: schoolRule.programmeId ?? undefined,
    });

    expect(match?.ruleKey).toBe('school-programme-review');
    expect(match?.assigneeRoleCode).toBe('module-tutor');
  });

  it('prefers lower priority before specificity', () => {
    const specificLowerPriority: WorkflowAssignmentRuleDto = {
      ...baseRule,
      workflowAssignmentRuleId: '00000000-0000-0000-0000-000000000003',
      ruleKey: 'specific-lower-priority',
      priority: 200,
      sourceSystemCode: 'ucas',
      assigneeRoleCode: 'module-tutor',
    };

    const match = selectWorkflowAssignmentRule([baseRule, specificLowerPriority], {
      workflowDefinitionVersionId: baseRule.workflowDefinitionVersionId,
      stepKey: 'admissions-review',
      sourceSystemCode: 'ucas',
    });

    expect(match?.ruleKey).toBe('registry-default');
  });

  it('blocks task completion when actor roles do not include the assigned role', () => {
    expect(() => assertActorCanCompleteWorkflowTask(
      { assigneeActorId: null, assigneeRoleCode: 'registry-administrator' },
      { actorId: 'actor-1', roles: ['module-tutor'] },
    )).toThrow(ForbiddenError);
  });

  it('allows task completion when actor has the assigned role', () => {
    expect(() => assertActorCanCompleteWorkflowTask(
      { assigneeActorId: null, assigneeRoleCode: 'module-tutor' },
      { actorId: 'actor-1', roles: ['module-tutor'] },
    )).not.toThrow();
  });
});
