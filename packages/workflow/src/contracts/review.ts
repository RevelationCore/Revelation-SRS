/**
 * Execution contract for single-review workflows run on Temporal.
 *
 * This file is imported by workflow code, so it must stay free of Node,
 * database or network imports. Only types, constants and pure functions.
 *
 * Bump REVIEW_EXECUTION_CONTRACT_VERSION when the workflow's observable
 * behaviour changes incompatibly; running executions keep the version they
 * started with (stored on workflow_instance.execution_contract_version).
 */

export const REVIEW_WORKFLOW_TYPE = 'reviewWorkflow';
export const REVIEW_EXECUTION_CONTRACT_VERSION = 1;

export const REVIEW_COMMAND_SIGNAL = 'reviewCommandSubmitted';
export const REVIEW_COMMAND_UPDATE = 'submitReviewCommand';
export const REVIEW_STATE_QUERY = 'reviewState';

export interface ReviewWorkflowInput {
  contractVersion: typeof REVIEW_EXECUTION_CONTRACT_VERSION;
  tenantId: string;
  workflowInstanceId: string;
  workflowTaskId: string;
  /** Persisted UTC deadline (ISO 8601). Resolved once, at start. */
  dueAt?: string | null;
  /** Role to reassign to when the deadline passes; absent means "needs attention". */
  escalateToRoleCode?: string | null;
}

/**
 * Signals and updates carry only a command ID. The command itself (actor,
 * decision, payload) is loaded from the database by an activity, so a
 * forged signal cannot introduce new authority.
 */
export interface ReviewCommandRef {
  commandId: string;
}

export type ReviewCommandOutcomeCode =
  /** The command was applied; the instance may now be closed. */
  | 'applied'
  /** The command was for a task revision that is no longer current. */
  | 'superseded'
  /** The decision was recorded but its business change could not be applied. */
  | 'failed';

export interface ReviewCommandOutcome {
  commandId: string;
  outcome: ReviewCommandOutcomeCode;
  commandType: 'decision' | 'cancellation';
  decisionCode?: string | null;
  /** True when this command closed the instance. */
  instanceClosed: boolean;
  closedAs?: 'completed' | 'cancelled';
  errorCode?: string | null;
  errorDetail?: string | null;
  result?: Record<string, unknown>;
}

export interface EscalateReviewTaskInput {
  tenantId: string;
  workflowInstanceId: string;
  workflowTaskId: string;
  escalateToRoleCode?: string | null;
}

export interface EscalateReviewTaskResult {
  /**
   * escalated        — reassigned to the escalation role; keep waiting.
   * needs-attention  — no escalation role; flagged for an operator; keep waiting.
   * decision-pending — a decision accepted on time is waiting to be applied.
   * not-open         — the task is already closed; nothing to do.
   */
  outcome: 'escalated' | 'needs-attention' | 'decision-pending' | 'not-open';
  pendingCommandId?: string;
}

export interface ApplyReviewCommandInput {
  tenantId: string;
  workflowInstanceId: string;
  commandId: string;
}

export interface ReviewActivities {
  applyReviewCommand(input: ApplyReviewCommandInput): Promise<ReviewCommandOutcome>;
  escalateReviewTask(input: EscalateReviewTaskInput): Promise<EscalateReviewTaskResult>;
}

export type ReviewPhase =
  | 'awaiting-decision'
  | 'applying'
  | 'needs-attention'
  | 'completed'
  | 'cancelled';

export interface ReviewWorkflowState {
  workflowInstanceId: string;
  workflowTaskId: string;
  phase: ReviewPhase;
  escalated: boolean;
  dueAt: string | null;
  processedCommandIds: string[];
}

/** Stable Temporal workflow ID. Contains only opaque identifiers. */
export function reviewWorkflowId(environmentCode: string, tenantId: string, workflowInstanceId: string): string {
  return `srs:${environmentCode}:${tenantId}:${workflowInstanceId}`;
}
