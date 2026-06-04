/** All RBAC roles defined in the actor catalogue. */
export const ROLES = [
  'student',
  'module-tutor',
  'personal-tutor',
  'research-supervisor',
  'wellbeing-advisor',
  'exam-board-member',
  'exam-board-chair',
  'external-examiner',
  'integrity-officer',
  'registry-administrator',
  'finance-administrator',
  'dpo',
  'tenant-administrator',
  'system-administrator',
  'integration-service',
] as const;

export type Role = (typeof ROLES)[number];

/**
 * Permission → roles that hold it.
 * Application middleware checks these at route level.
 */
export const PERMISSION_ROLES = {
  'student:read:own':          ['student'] as Role[],
  'student:read:all':          ['registry-administrator', 'exam-board-chair', 'wellbeing-advisor', 'dpo'] as Role[],
  'student:write':             ['registry-administrator'] as Role[],
  'enrolment:read:own':        ['student'] as Role[],
  'enrolment:read:all':        ['registry-administrator', 'exam-board-chair', 'wellbeing-advisor', 'finance-administrator'] as Role[],
  'enrolment:write':           ['registry-administrator'] as Role[],
  'mark:read:own':             ['student'] as Role[],
  'mark:read:all':             ['registry-administrator', 'module-tutor', 'exam-board-chair', 'exam-board-member'] as Role[],
  'mark:write':                ['registry-administrator', 'module-tutor'] as Role[],
  'exam-board:read':           ['registry-administrator', 'exam-board-chair', 'exam-board-member', 'external-examiner'] as Role[],
  'exam-board:ratify':         ['exam-board-chair'] as Role[],
  'adjustment:read:own':       ['student'] as Role[],
  'adjustment:read:all':       ['registry-administrator', 'wellbeing-advisor'] as Role[],
  'adjustment:write':          ['registry-administrator', 'wellbeing-advisor'] as Role[],
  'special-category:read':     ['wellbeing-advisor', 'dpo', 'registry-administrator'] as Role[],
  'config:write':              ['tenant-administrator'] as Role[],
  'integration:manage':        ['tenant-administrator'] as Role[],
  'audit:read':                ['dpo', 'system-administrator'] as Role[],
  'tenant:manage':             ['system-administrator'] as Role[],
  'rule:read':                 ['registry-administrator', 'tenant-administrator'] as Role[],
  'rule:write':                ['tenant-administrator'] as Role[],
} as const;

export type Permission = keyof typeof PERMISSION_ROLES;

export function hasPermission(roles: Role[], permission: Permission): boolean {
  const required = PERMISSION_ROLES[permission] as readonly Role[];
  return roles.some((r) => required.includes(r));
}
