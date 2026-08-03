export const STUDENT_ROLES = ['student'] as const;

export const STAFF_ROLES = [
  'registry-administrator',
  'module-tutor',
  'personal-tutor',
  'engagement-officer',
  'research-supervisor',
  'wellbeing-advisor',
  'exam-board-member',
  'exam-board-chair',
  'external-examiner',
  'integrity-officer',
  'finance-administrator',
  'dpo',
  'tenant-administrator',
  'system-administrator',
  'pgr-administrator',
  'pgr-director',
] as const;

export type StudentRole = (typeof STUDENT_ROLES)[number];
export type StaffRole   = (typeof STAFF_ROLES)[number];
export type AppRole     = StudentRole | StaffRole;

export function hasRole(roles: string[], role: string): boolean {
  return roles.includes(role);
}

export function hasAnyRole(roles: string[], candidates: readonly string[]): boolean {
  return candidates.some(r => roles.includes(r));
}

export function isStudentOnly(roles: string[]): boolean {
  return hasAnyRole(roles, STUDENT_ROLES) && !hasAnyRole(roles, STAFF_ROLES);
}

export function isStaffUser(roles: string[]): boolean {
  return hasAnyRole(roles, STAFF_ROLES);
}
