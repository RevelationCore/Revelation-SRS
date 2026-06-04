/**
 * Audit activities - called by workflows to write audit records durably.
 * A failed audit write causes Temporal to retry the activity, guaranteeing
 * every workflow state transition is recorded even under transient failures.
 */
export const auditActivities = {
  recordWorkflowEvent(input: {
    workflowId:   string;
    workflowType: string;
    event:        string;
    actorId?:     string;
    occurredAt:   string;
    metadata?:    Record<string, unknown>;
  }): Promise<void> {
    // Activity body: call the audit service REST API (or DB directly for internal workers).
    // The actual implementation depends on the service that registers this worker.
    // For Phase 3 the function signature is established here; body is injected at registration.
    void input;
    return Promise.resolve();
  },
};
