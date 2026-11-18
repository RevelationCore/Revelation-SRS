/**
 * Status lifecycles for wellbeing case records.
 *
 * Each map gives, for a status, the statuses a practitioner may move it to.
 * A status with no onward statuses is final. Routes reject any other
 * transition with 409, and detail responses carry the allowed next statuses
 * so the admin screens only offer valid actions.
 *
 * The codes match the comments on the schema columns (src/db/schema).
 */

export const DISABILITY_CASE_TRANSITIONS: Readonly<Record<string, readonly string[]>> = {
  assessment_pending: ['evidence_pending', 'active', 'rejected', 'closed'],
  evidence_pending:   ['assessment_pending', 'active', 'rejected', 'closed'],
  active:             ['evidence_pending', 'closed'],
  rejected:           ['closed'],
  closed:             [],
};

export const MENTAL_HEALTH_CASE_TRANSITIONS: Readonly<Record<string, readonly string[]>> = {
  referral_received:  ['assessment_pending', 'active', 'closed'],
  assessment_pending: ['active', 'on_hold', 'closed'],
  active:             ['on_hold', 'discharged'],
  on_hold:            ['active', 'discharged', 'closed'],
  discharged:         ['closed'],
  closed:             [],
};

export const INTERVENTION_PLAN_TRANSITIONS: Readonly<Record<string, readonly string[]>> = {
  draft:        ['active', 'discontinued'],
  active:       ['completed', 'discontinued'],
  completed:    [],
  discontinued: [],
};

export const EVIDENCE_TRANSITIONS: Readonly<Record<string, readonly string[]>> = {
  pending:  ['received', 'rejected'],
  received: ['verified', 'rejected'],
  verified: [],
  rejected: [],
};

export const ALERT_TRIAGE_TRANSITIONS: Readonly<Record<string, readonly string[]>> = {
  pending:   ['reviewed', 'assigned', 'resolved', 'dismissed'],
  reviewed:  ['assigned', 'resolved', 'dismissed'],
  assigned:  ['resolved'],
  resolved:  [],
  dismissed: [],
};

/** Disability and mental-health cases in these statuses are left out of a caseload. */
export const CLOSED_DISABILITY_STATUSES = ['closed', 'rejected'] as const;
export const CLOSED_MENTAL_HEALTH_STATUSES = ['closed'] as const;

export function allowedNext(rules: Readonly<Record<string, readonly string[]>>, from: string): string[] {
  return [...(rules[from] ?? [])];
}

export class StatusTransitionError extends Error {
  readonly statusCode = 409;
  constructor(readonly entity: string, readonly from: string, readonly to: string, readonly allowed: string[]) {
    super(
      allowed.length === 0
        ? `A ${entity} in status '${from}' cannot change status`
        : `A ${entity} cannot move from '${from}' to '${to}'; allowed: ${allowed.join(', ')}`,
    );
  }
}

/** Throws StatusTransitionError unless `to` is an allowed next status of `from`. */
export function assertTransition(
  rules: Readonly<Record<string, readonly string[]>>,
  entity: string,
  from: string,
  to: string,
): void {
  const allowed = allowedNext(rules, from);
  if (!allowed.includes(to)) throw new StatusTransitionError(entity, from, to, allowed);
}
