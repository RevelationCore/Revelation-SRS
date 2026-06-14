import { describe, expect, it } from 'vitest';

import { selectMatchingAssignment, type FeatureFlagAssignmentDto } from '../src/platform/platform-controls/feature-flag-service.js';

const baseAssignment: FeatureFlagAssignmentDto = {
  featureFlagAssignmentId: '00000000-0000-0000-0000-000000000001',
  tenantId: 'tenant-1',
  environmentId: null,
  featureFlagId: 'flag-1',
  variantId: 'variant-1',
  workflowDefinitionVersionId: null,
  roleCode: null,
  cohortCode: null,
  programmeId: null,
  academicYear: null,
  sourceSystemCode: null,
  priority: 100,
  statusCode: 'active',
  ruleExpression: null,
  configuration: {},
  activeFrom: new Date('2026-01-01T00:00:00.000Z'),
  activeTo: null,
  createdBy: 'test',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
};

describe('feature flag evaluation precedence', () => {
  it('prefers lower priority before specificity', () => {
    const highPriority = { ...baseAssignment, featureFlagAssignmentId: '00000000-0000-0000-0000-000000000002', priority: 10 };
    const specific = {
      ...baseAssignment,
      featureFlagAssignmentId: '00000000-0000-0000-0000-000000000003',
      priority: 20,
      environmentId: 'env-1',
      roleCode: 'registry-administrator',
    };

    expect(selectMatchingAssignment([specific, highPriority], {
      tenantId: 'tenant-1',
      environmentId: 'env-1',
      roleCode: 'registry-administrator',
    })?.featureFlagAssignmentId).toBe(highPriority.featureFlagAssignmentId);
  });

  it('uses specificity when priority is tied', () => {
    const broad = { ...baseAssignment, featureFlagAssignmentId: '00000000-0000-0000-0000-000000000004' };
    const specific = {
      ...baseAssignment,
      featureFlagAssignmentId: '00000000-0000-0000-0000-000000000005',
      environmentId: 'env-1',
      roleCode: 'tenant-administrator',
    };

    expect(selectMatchingAssignment([broad, specific], {
      tenantId: 'tenant-1',
      environmentId: 'env-1',
      roleCode: 'tenant-administrator',
    })?.featureFlagAssignmentId).toBe(specific.featureFlagAssignmentId);
  });

  it('ignores inactive and mismatched assignments', () => {
    const inactive = { ...baseAssignment, featureFlagAssignmentId: '00000000-0000-0000-0000-000000000006', statusCode: 'paused' };
    const mismatch = { ...baseAssignment, featureFlagAssignmentId: '00000000-0000-0000-0000-000000000007', roleCode: 'registry-administrator' };

    expect(selectMatchingAssignment([inactive, mismatch], {
      tenantId: 'tenant-1',
      roleCode: 'tenant-administrator',
    })).toBeNull();
  });
});
