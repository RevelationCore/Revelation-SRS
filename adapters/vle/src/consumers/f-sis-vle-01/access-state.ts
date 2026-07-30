/**
 * Maps SRS student enrolment status codes to VLE access states.
 *
 * SRS statuses come from the student-status-changed event (newStatus field).
 * VLE access states drive what the student can see/do in the learning platform.
 */
export type VleAccessState = 'active' | 'suspended' | 'withdrawn' | 'completed';

const STATUS_MAP: Record<string, VleAccessState> = {
  active:      'active',
  suspended:   'suspended',
  interrupted: 'suspended',
  withdrawn:   'withdrawn',
  completed:   'completed',
};

/**
 * Converts an SRS student status to the VLE access state.
 * Unknown statuses default to 'suspended' (safe — denies access without data loss).
 */
export function toVleAccessState(srsStatus: string | undefined): VleAccessState {
  if (!srsStatus) return 'suspended';
  return STATUS_MAP[srsStatus.toLowerCase()] ?? 'suspended';
}
