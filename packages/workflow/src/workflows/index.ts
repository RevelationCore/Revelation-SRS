import { proxyActivities } from '@temporalio/workflow';

import type { auditActivities } from '../activities/audit.activities.js';

const activities = proxyActivities<typeof auditActivities>({
  startToCloseTimeout: '30 seconds',
  retry: {
    initialInterval: '1 second',
    maximumAttempts: 3,
  },
});

export interface RecordAuditWorkflowInput {
  workflowId:   string;
  workflowType: string;
  event:        string;
  actorId?:     string;
  occurredAt:   string;
  metadata?:    Record<string, unknown>;
}

export async function recordAuditWorkflow(input: RecordAuditWorkflowInput): Promise<void> {
  await activities.recordWorkflowEvent(input);
}
