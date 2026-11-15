import { extraMinutesFor, formatPercent } from './time-accommodation.js';
import {
  VlePlatformError,
  type AccommodationResult,
  type FetchLike,
  type PersonInCourse,
  type VlePlatformDriver,
} from './driver.js';

export const SRS_TIME_GROUP_PREFIX = 'srs-extra-time-';
/** The reason on every quiz override the SRS creates; it owns only those. */
export const SRS_OVERRIDE_REASON = 'SRS reasonable adjustment (managed automatically; do not edit)';

/**
 * groups         — SRS-managed "Extra time +N%" groups; staff add a group
 *                  override to each timed quiz. Works on any Moodle with the
 *                  core_group web services.
 * quiz-overrides — the SRS writes a user override on every timed quiz
 *                  (time limit + the student's extra time), so nothing is left
 *                  to staff. Needs mod_quiz_get_quizzes_by_courses and the
 *                  mod_quiz_*_overrides web services (present in Moodle 5.3.1).
 */
export type MoodleStrategy = 'groups' | 'quiz-overrides';

/**
 * Moodle driver: SRS-managed extra-time groups.
 *
 * Moodle stores extra time as a quiz override (a replacement time limit) for a
 * user or a group. The driver does not write per-user quiz overrides: one
 * must be re-created for every quiz staff add, and the override web services
 * (mod_quiz_save_overrides, mod_quiz_get_overrides, mod_quiz_delete_overrides)
 * are absent from Moodle's published function list — though present in
 * Moodle 5.3.1, so a per-quiz driver is possible there. It keeps each student
 * in the group for their
 * entitlement instead — "Extra time +25% (SRS)", idnumber srs-extra-time-25 —
 * and course staff give that group an override on each timed quiz (time
 * limit x 1.25), the arrangement many UK institutions already use. New quizzes
 * then only need the group override, and the SRS keeps membership correct.
 *
 * Web services used (REST, moodlewsrestformat=json; array parameters as
 * name[0][field]=value):
 *   core_user_get_users_by_field   field=idnumber, values[0]=<SRS personId>
 *   core_group_get_course_groups   courseid
 *   core_group_create_groups       groups[0][courseid|name|description|idnumber]
 *   core_group_get_group_members   groupids[n]
 *   core_group_add_group_members   members[0][groupid|userid]
 *   core_group_delete_group_members members[0][groupid|userid]
 *
 * The web-service user needs those functions enabled and permission to
 * manage groups in the course. Moodle reports web-service errors as HTTP 200
 * with an { exception, errorcode, message } body, which this treats as a
 * failure.
 *
 * Verified against Moodle 5.3.1 (infra/compose/moodle.compose.yml,
 * test/moodle-live.int.test.ts).
 */
export class MoodleDriver implements VlePlatformDriver {
  readonly platform = 'moodle' as const;
  readonly #userIds = new Map<string, number>();

  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    private readonly fetchImpl: FetchLike = fetch,
    readonly strategy: MoodleStrategy = 'groups',
  ) {}

  async setTimeAccommodation(target: PersonInCourse, extraTimePercent: number): Promise<AccommodationResult> {
    const userId = await this.#resolveUserId(target.personId);
    return this.strategy === 'quiz-overrides'
      ? this.#syncQuizOverrides(userId, target.vleCourseId, extraTimePercent)
      : this.#syncGroups(userId, target.vleCourseId, extraTimePercent);
  }

  /**
   * One user override per timed quiz with time limit = limit + extra time
   * (rounded up to the minute). Moodle holds one user override per quiz per
   * student, and saving one sets every field, so the driver only ever writes
   * overrides it owns (reason = SRS_OVERRIDE_REASON). If staff already have
   * an override for the student on a quiz, theirs takes precedence: it is
   * left untouched and reported as a warning, so staff can include the extra
   * time in it. At 0 the SRS's own overrides are deleted.
   */
  async #syncQuizOverrides(userId: number, courseId: string, extraTimePercent: number): Promise<AccommodationResult> {
    const { quizzes } = await this.#call<{ quizzes: Array<{ id: number; timelimit?: number | null }> }>(
      'mod_quiz_get_quizzes_by_courses', { 'courseids[0]': courseId },
    );
    let changes = 0;
    const warnings: string[] = [];

    for (const quiz of quizzes) {
      const limit = quiz.timelimit ?? 0;
      const { overrides } = await this.#call<{ overrides: MoodleQuizOverride[] }>('mod_quiz_get_overrides', { quizid: quiz.id });
      const mine = overrides.find((o) => o.userid === userId);
      const owned = mine?.reason === SRS_OVERRIDE_REASON;

      if (mine && !owned) {
        if (extraTimePercent > 0 && limit > 0) {
          warnings.push(`Quiz ${quiz.id} already has a staff override for this student; extra time not applied there`);
        }
        continue;
      }

      const wanted = limit > 0 && extraTimePercent > 0
        ? limit + extraMinutesFor(limit / 60, extraTimePercent) * 60
        : null;

      if (wanted === null) {
        if (mine) {
          await this.#call('mod_quiz_delete_overrides', { 'data[quizid]': quiz.id, 'data[ids][0]': mine.id });
          changes += 1;
        }
        continue;
      }
      if (mine?.timelimit === wanted) continue;

      await this.#call('mod_quiz_save_overrides', {
        'data[quizid]': quiz.id,
        ...(mine ? { 'data[overrides][0][id]': mine.id } : {}),
        'data[overrides][0][userid]': userId,
        'data[overrides][0][timelimit]': wanted,
        'data[overrides][0][reason]': SRS_OVERRIDE_REASON,
      });
      changes += 1;
    }
    return warnings.length > 0 ? { changes, warnings } : { changes };
  }

  async #syncGroups(userId: number, courseId: string, extraTimePercent: number): Promise<AccommodationResult> {
    const wantedIdNumber = extraTimePercent > 0 ? `${SRS_TIME_GROUP_PREFIX}${formatPercent(extraTimePercent)}` : null;
    let changes = 0;

    const groups = await this.#call<MoodleGroup[]>('core_group_get_course_groups', { courseid: courseId });
    const srsGroups = groups.filter((g) => g.idnumber?.startsWith(SRS_TIME_GROUP_PREFIX));

    let wanted = wantedIdNumber ? srsGroups.find((g) => g.idnumber === wantedIdNumber) : undefined;
    if (wantedIdNumber && !wanted) {
      const pct = formatPercent(extraTimePercent);
      const [created] = await this.#call<MoodleGroup[]>('core_group_create_groups', {
        'groups[0][courseid]':    courseId,
        'groups[0][name]':        `Extra time +${pct}% (SRS)`,
        'groups[0][description]': `Managed by the SRS. Give this group a quiz override of the time limit plus ${pct}% on each timed quiz. Membership is set from approved reasonable adjustments; do not edit it by hand.`,
        'groups[0][idnumber]':    wantedIdNumber,
      });
      if (!created) throw new VlePlatformError('Moodle did not return the created group', 'moodle');
      wanted = created;
      srsGroups.push(created);
    }

    const membership = srsGroups.length === 0
      ? []
      : await this.#call<Array<{ groupid: number; userids: number[] }>>(
          'core_group_get_group_members',
          Object.fromEntries(srsGroups.map((g, i) => [`groupids[${i}]`, g.id])),
        );
    const isMember = (groupId: number): boolean =>
      membership.some((m) => m.groupid === groupId && m.userids.includes(userId));

    for (const g of srsGroups) {
      if (g.id !== wanted?.id && isMember(g.id)) {
        await this.#call('core_group_delete_group_members', { 'members[0][groupid]': g.id, 'members[0][userid]': userId });
        changes += 1;
      }
    }
    if (wanted && !isMember(wanted.id)) {
      await this.#call('core_group_add_group_members', { 'members[0][groupid]': wanted.id, 'members[0][userid]': userId });
      changes += 1;
    }

    return { changes };
  }

  async #resolveUserId(personId: string): Promise<number> {
    const cached = this.#userIds.get(personId);
    if (cached !== undefined) return cached;
    const users = await this.#call<Array<{ id: number }>>('core_user_get_users_by_field', {
      field: 'idnumber',
      'values[0]': personId,
    });
    const user = users[0];
    if (!user) throw new VlePlatformError(`Moodle has no user with ID number ${personId}`, 'moodle', 404);
    this.#userIds.set(personId, user.id);
    return user.id;
  }

  async #call<T = unknown>(wsfunction: string, params: Record<string, string | number>): Promise<T> {
    const body = new URLSearchParams({ wstoken: this.token, wsfunction, moodlewsrestformat: 'json' });
    for (const [k, v] of Object.entries(params)) body.append(k, String(v));

    const res = await this.fetchImpl(`${this.baseUrl}/webservice/rest/server.php`, {
      method:  'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body:    body.toString(),
    });
    if (!res.ok) throw new VlePlatformError(`Moodle ${wsfunction} failed: ${res.status}`, 'moodle', res.status);
    const text = await res.text();
    const data: unknown = text ? JSON.parse(text) : null;
    if (data && typeof data === 'object' && !Array.isArray(data) && 'exception' in data) {
      const err = data as { errorcode?: string; message?: string };
      throw new VlePlatformError(`Moodle ${wsfunction}: ${err.errorcode ?? 'error'} — ${err.message ?? ''}`, 'moodle');
    }
    return data as T;
  }
}

interface MoodleGroup { id: number; courseid: number; name: string; idnumber?: string }
interface MoodleQuizOverride { id: number; quiz: number; userid: number | null; groupid: number | null; timelimit: number | null; reason: string | null }
