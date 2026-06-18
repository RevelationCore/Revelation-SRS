/** Base class for all domain errors. Carries an RFC 7807 `type` suffix. */
export declare class DomainError extends Error {
    readonly code: string;
    readonly statusCode: number;
    constructor(message: string, code: string, statusCode?: number);
}
export declare class NotFoundError extends DomainError {
    constructor(resource: string, id: string);
}
export declare class ForbiddenError extends DomainError {
    constructor(message?: string);
}
export declare class ConflictError extends DomainError {
    constructor(message: string);
}
export declare class RecordLockedError extends DomainError {
    constructor(resource: string, id: string);
}
export declare class ValidationError extends DomainError {
    readonly fields?: Array<{
        field: string;
        message: string;
    }> | undefined;
    constructor(message: string, fields?: Array<{
        field: string;
        message: string;
    }> | undefined);
}
export declare class RuleNotConfiguredError extends DomainError {
    constructor(ruleType: string, context: string);
}
//# sourceMappingURL=errors.d.ts.map