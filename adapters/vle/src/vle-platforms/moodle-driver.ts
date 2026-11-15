import { formatPercent } from './time-accommodation.js';
import {
  VlePlatformError,
  type AccommodationResult,
  type FetchLike,
  type PersonInCourse,
  type VlePlatformDriver,
} from './driver.js';

export const SRS_TIME_GROUP_PREFIX = 'srs-extra-time-';

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
  ) {}

  async setTimeAccommodation(target: PersonInCourse, extraTimePercent: number): Promise<AccommodationResult> {
    const userId = await this.#resolveUserId(target.personId);
    const courseId = target.vleCourseId;
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
