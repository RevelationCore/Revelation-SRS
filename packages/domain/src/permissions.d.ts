/** All RBAC roles defined in the actor catalogue. */
export declare const ROLES: readonly ["student", "module-tutor", "personal-tutor", "research-supervisor", "wellbeing-advisor", "wellbeing-mental-health-advisor", "wellbeing-panel-chair", "wellbeing-auditor", "exam-board-member", "exam-board-chair", "external-examiner", "integrity-officer", "registry-administrator", "regulatory-officer", "finance-administrator", "dpo", "tenant-administrator", "system-administrator", "integration-service"];
export type Role = (typeof ROLES)[number];
/**
 * Permission → roles that hold it.
 * Application middleware checks these at route level.
 */
export declare const PERMISSION_ROLES: {
    readonly 'student:read:own': Role[];
    readonly 'student:read:all': Role[];
    readonly 'student:write': Role[];
    readonly 'enrolment:read:own': Role[];
    readonly 'enrolment:read:all': Role[];
    readonly 'enrolment:write': Role[];
    readonly 'mark:read:own': Role[];
    readonly 'mark:read:all': Role[];
    readonly 'mark:write': Role[];
    readonly 'exam-board:read': Role[];
    readonly 'exam-board:ratify': Role[];
    readonly 'adjustment:read:own': Role[];
    readonly 'adjustment:read:all': Role[];
    readonly 'adjustment:write': Role[];
    readonly 'special-category:read': Role[];
    readonly 'mh-session-note:read': Role[];
    readonly 'panel-decision:write': Role[];
    readonly 'wellbeing-sar:export': Role[];
    readonly 'wellbeing-retention:write': Role[];
    readonly 'config:write': Role[];
    readonly 'integration:manage': Role[];
    readonly 'audit:read': Role[];
    readonly 'tenant:manage': Role[];
    readonly 'rule:read': Role[];
    readonly 'rule:write': Role[];
    readonly 'module-registration:read:own': Role[];
    readonly 'module-registration:read:all': Role[];
    readonly 'module-registration:write': Role[];
    readonly 'catalogue:read': Role[];
    readonly 'catalogue:write': Role[];
    readonly 'calendar:read': Role[];
    readonly 'calendar:write': Role[];
    readonly 'disability:read': Role[];
    readonly 'disability:write': Role[];
    readonly 'exam-board:write': Role[];
    readonly 'circumstances:read': Role[];
    readonly 'circumstances:write': Role[];
    readonly 'progression:read': Role[];
    readonly 'progression:write': Role[];
    readonly 'regulatory:read': Role[];
    readonly 'regulatory:write': Role[];
    readonly 'workflow:read': Role[];
    readonly 'workflow:write': Role[];
    readonly 'workflow-task:complete': Role[];
    readonly 'feature-flag:read': Role[];
    readonly 'feature-flag:write': Role[];
    readonly 'feature-flag:govern': Role[];
    readonly 'environment:read': Role[];
    readonly 'environment:write': Role[];
    readonly 'globalisation:read': Role[];
    readonly 'globalisation:write': Role[];
    readonly 'communications:read': Role[];
    readonly 'communications:write': Role[];
};
export type Permission = keyof typeof PERMISSION_ROLES;
export declare function hasPermission(roles: Role[], permission: Permission): boolean;
//# sourceMappingURL=permissions.d.ts.map