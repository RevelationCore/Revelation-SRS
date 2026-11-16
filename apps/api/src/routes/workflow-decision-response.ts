import { Type } from '@sinclair/typebox';

/**
 * Response for a decision on a Temporal-run review that was saved but not
 * yet applied (ADR-024): the worker applies it shortly. Poll statusUrl.
 */
export const PendingDecisionSchema = Type.Object({
  status:    Type.Literal('pending'),
  commandId: Type.String(),
  statusUrl: Type.String(),
});

export function pendingDecision(commandId: string) {
  return { status: 'pending' as const, commandId, statusUrl: `/api/v1/workflow-commands/${commandId}` };
}
