import { describe, expect, it } from 'vitest';

import {
  resolveTransitionMatrix,
  TransitionValidator,
  transitionAuditValue,
  type TransitionMatrix,
} from '../src/platform/workflow/transition-service.js';
import type { ValueSetService } from '../src/platform/value-sets/service.js';

type Status = 'open' | 'review' | 'closed' | 'void';

const defaults: TransitionMatrix<Status> = {
  open: ['review', 'closed'],
  review: ['closed'],
  closed: [],
  void: [],
};

describe('transition validator', () => {
  it('allows transitions from the default matrix and records audit evidence', async () => {
    const validator = new TransitionValidator();
    const result = await validator.assertAllowed({
      tenantId: 'tenant-1',
      entityName: 'case',
      fieldName: 'status_code',
      entityLabel: 'case',
      fromStatus: 'open',
      toStatus: 'review',
      defaultTransitions: defaults,
    });

    expect(result.ruleSource).toBe('default-configuration');
    expect(transitionAuditValue(result)).toMatchObject({
      fromStatusCode: 'open',
      toStatusCode: 'review',
      allowedTargets: ['review', 'closed'],
      valueSetChecked: false,
    });
  });

  it('rejects transitions not present in the active matrix', async () => {
    const validator = new TransitionValidator();

    await expect(validator.assertAllowed({
      tenantId: 'tenant-1',
      entityName: 'case',
      fieldName: 'status_code',
      entityLabel: 'case',
      fromStatus: 'closed',
      toStatus: 'review',
      defaultTransitions: defaults,
    })).rejects.toThrow("Cannot transition case from 'closed' to 'review'");
  });

  it('can resolve a configured workflow transition matrix', () => {
    const resolved = resolveTransitionMatrix(defaults, [
      { fromStatusCode: 'open', toStatusCode: 'void' },
      { fromStatusCode: 'void', toStatusCode: 'review' },
    ]);

    expect(resolved.ruleSource).toBe('workflow-configuration');
    expect(resolved.matrix.open).toEqual(['void']);
    expect(resolved.matrix.void).toEqual(['review']);
  });

  it('checks target status against value-set configuration when available', async () => {
    const valueSets = {
      // eslint-disable-next-line @typescript-eslint/require-await
      validateFieldValue: async () => false,
    } as Pick<ValueSetService, 'validateFieldValue'> as ValueSetService;
    const validator = new TransitionValidator(valueSets);

    await expect(validator.assertAllowed({
      tenantId: 'tenant-1',
      entityName: 'case',
      fieldName: 'status_code',
      entityLabel: 'case',
      fromStatus: 'open',
      toStatus: 'review',
      defaultTransitions: defaults,
    })).rejects.toThrow("Invalid transition target 'review'");
  });
});
