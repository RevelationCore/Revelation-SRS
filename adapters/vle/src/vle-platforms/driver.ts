/**
 * VLE platform drivers — the platform-specific end of the integration layer.
 *
 * The SRS publishes platform-neutral instructions (type, scope, structured
 * amount, dates). The connector reduces a student's active adjustments to a
 * desired state per course (see time-accommodation.ts) and a driver makes the
 * platform match it, using that platform's own mechanism:
 *
 *   stub   — the in-process simulator (default; safety class 'simulator')
 *   canvas — per-quiz extra minutes on every timed Classic quiz and New Quiz
 *   moodle — membership of an SRS-managed "Extra time +N%" group per course;
 *            staff attach a group override to each timed quiz
 *
 * Every call states the WHOLE desired value (0 = none), never a delta, so a
 * call is safe to repeat and the same call removes an accommodation on
 * withdrawal. A driver resolves the student's platform identity from the SRS
 * personId, which the connector already uses as the student's identifier in
 * the VLE.
 */

export type VlePlatform = 'stub' | 'canvas' | 'moodle';

export interface PersonInCourse {
  /** The VLE course id recorded in vle_course_map. */
  vleCourseId: string;
  /** SRS person id; the VLE user's SIS/ID number. */
  personId:    string;
}

export interface AccommodationResult {
  /** Platform writes made (quizzes updated, group memberships changed). */
  changes: number;
}

export interface VlePlatformDriver {
  readonly platform: VlePlatform;
  setTimeAccommodation(target: PersonInCourse, extraTimePercent: number): Promise<AccommodationResult>;
}

export class VlePlatformError extends Error {
  constructor(
    message: string,
    public readonly platform: VlePlatform,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'VlePlatformError';
  }
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
