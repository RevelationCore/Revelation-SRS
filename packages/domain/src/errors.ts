/** Base class for all domain errors. Carries an RFC 7807 `type` suffix. */
export class DomainError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number = 400,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}

export class NotFoundError extends DomainError {
  constructor(resource: string, id: string) {
    super(`${resource} '${id}' not found`, 'not-found', 404);
    this.name = 'NotFoundError';
  }
}

export class ForbiddenError extends DomainError {
  constructor(message = 'Insufficient permissions') {
    super(message, 'forbidden', 403);
    this.name = 'ForbiddenError';
  }
}

export class ConflictError extends DomainError {
  constructor(message: string) {
    super(message, 'conflict', 409);
    this.name = 'ConflictError';
  }
}

export class RecordLockedError extends DomainError {
  constructor(resource: string, id: string) {
    super(`${resource} '${id}' is locked and cannot be modified outside a correction workflow`, 'record-locked', 409);
    this.name = 'RecordLockedError';
  }
}

export class ValidationError extends DomainError {
  constructor(
    message: string,
    public readonly fields?: Array<{ field: string; message: string }>,
  ) {
    super(message, 'validation-error', 422);
    this.name = 'ValidationError';
  }
}

export class RuleNotConfiguredError extends DomainError {
  constructor(ruleType: string, context: string) {
    super(`Rule '${ruleType}' is not configured for ${context}`, 'rule-not-configured', 500);
    this.name = 'RuleNotConfiguredError';
  }
}
