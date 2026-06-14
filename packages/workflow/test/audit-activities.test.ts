import { describe, expect, it } from 'vitest';

import { auditActivities, createAuditActivities, type RecordWorkflowEventInput } from '../src/activities/audit.activities.js';

describe('workflow audit activities', () => {
  it('delegates workflow audit events to the configured writer', async () => {
    const calls: RecordWorkflowEventInput[] = [];
    const activities = createAuditActivities({
      recordWorkflowEvent(input) {
        calls.push(input);
        return Promise.resolve();
      },
    });

    await activities.recordWorkflowEvent({
      tenantId: 'tenant-1',
      workflowInstanceId: '00000000-0000-0000-0000-000000000001',
      workflowType: 'test-workflow',
      event: 'task-assigned',
      actorId: 'user-1',
      occurredAt: '2026-06-13T12:00:00.000Z',
      metadata: { stepKey: 'review' },
    });

    expect(calls).toEqual([
      expect.objectContaining({
        workflowInstanceId: '00000000-0000-0000-0000-000000000001',
        event: 'task-assigned',
      }),
    ]);
  });

  it('fails loudly when no audit writer is configured', async () => {
    expect(() => auditActivities.recordWorkflowEvent({
      workflowInstanceId: '00000000-0000-0000-0000-000000000001',
      workflowType: 'test-workflow',
      event: 'task-assigned',
      occurredAt: '2026-06-13T12:00:00.000Z',
    })).toThrow('not configured');
  });
});
