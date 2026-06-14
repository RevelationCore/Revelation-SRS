export interface RecordWorkflowEventInput {
  tenantId?: string;
  workflowInstanceId: string;
  workflowType: string;
  event: string;
  actorId?: string;
  occurredAt: string;
  metadata?: Record<string, unknown>;
}

export interface WorkflowAuditWriter {
  recordWorkflowEvent(input: RecordWorkflowEventInput): Promise<void>;
}

/**
 * Audit activities - called by workflows to write audit records durably.
 * A failed audit write causes Temporal to retry the activity, guaranteeing
 * every workflow state transition is recorded even under transient failures.
 */
export function createAuditActivities(writer: WorkflowAuditWriter): WorkflowAuditWriter {
  return {
    recordWorkflowEvent(input) {
      return writer.recordWorkflowEvent(input);
    },
  };
}

export const auditActivities = createAuditActivities({
  recordWorkflowEvent(): Promise<void> {
    throw new Error('Workflow audit activity is not configured with a writer');
  },
});
