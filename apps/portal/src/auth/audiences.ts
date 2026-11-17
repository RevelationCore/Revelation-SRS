/**
 * Who the self-service portal is serving (Phase 5 D-38, ADR-025). The
 * portal is for everyone outside the back office; what it shows follows the
 * signed-in roles. Every page still relies on the API, which scopes data to
 * the srs_person_id claim.
 */
export type Audience = 'student' | 'applicant' | 'research';

export function audiencesFor(roles: readonly string[]): Set<Audience> {
  const out = new Set<Audience>();
  if (roles.includes('student')) out.add('student');
  if (roles.includes('applicant')) out.add('applicant');
  if (roles.includes('research-supervisor') || roles.includes('pgr-examiner')) out.add('research');
  return out;
}
