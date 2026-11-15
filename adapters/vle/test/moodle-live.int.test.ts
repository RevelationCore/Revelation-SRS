/**
 * MoodleDriver against a real Moodle (infra/compose/moodle.compose.yml).
 *
 * Skipped unless MOODLE_URL, MOODLE_TOKEN, MOODLE_COURSE_ID and
 * MOODLE_PERSON_ID are set — infra/compose/moodle/setup.sh prints them. The
 * unit tests (vle-platforms.test.ts) check the requests against a fake; this
 * checks a real Moodle accepts them and ends in the intended state.
 */
import { describe, expect, it } from 'vitest';

import { MoodleDriver, SRS_TIME_GROUP_PREFIX } from '../src/vle-platforms/moodle-driver.js';

const url = process.env['MOODLE_URL'];
const token = process.env['MOODLE_TOKEN'];
const courseId = process.env['MOODLE_COURSE_ID'];
const personId = process.env['MOODLE_PERSON_ID'];
const configured = Boolean(url && token && courseId && personId);

async function ws<T>(wsfunction: string, params: Record<string, string | number>): Promise<T> {
  const body = new URLSearchParams({ wstoken: token!, wsfunction, moodlewsrestformat: 'json' });
  for (const [k, v] of Object.entries(params)) body.append(k, String(v));
  const res = await fetch(`${url}/webservice/rest/server.php`, { method: 'POST', body });
  const data = await res.json() as T & { exception?: string; message?: string };
  if (data && typeof data === 'object' && 'exception' in data) throw new Error(`${wsfunction}: ${data.message}`);
  return data;
}

/** The SRS time groups in the course, with whether the test student is in each. */
async function srsMembership(): Promise<Record<string, boolean>> {
  const [user] = await ws<Array<{ id: number }>>('core_user_get_users_by_field', { field: 'idnumber', 'values[0]': personId! });
  const groups = (await ws<Array<{ id: number; idnumber: string }>>('core_group_get_course_groups', { courseid: courseId! }))
    .filter((g) => g.idnumber.startsWith(SRS_TIME_GROUP_PREFIX));
  if (groups.length === 0) return {};
  const members = await ws<Array<{ groupid: number; userids: number[] }>>(
    'core_group_get_group_members',
    Object.fromEntries(groups.map((g, i) => [`groupids[${i}]`, g.id])),
  );
  return Object.fromEntries(groups.map((g) => [
    g.idnumber,
    members.some((m) => m.groupid === g.id && m.userids.includes(user!.id)),
  ]));
}

describe.skipIf(!configured)('MoodleDriver against a real Moodle', () => {
  const driver = new MoodleDriver(url!, token!);
  const target = { vleCourseId: courseId!, personId: personId! };

  it('puts the student in the SRS group for their entitlement, creating it', async () => {
    await driver.setTimeAccommodation(target, 0);
    await driver.setTimeAccommodation(target, 25);

    const membership = await srsMembership();
    expect(membership[`${SRS_TIME_GROUP_PREFIX}25`]).toBe(true);
    expect(Object.entries(membership).filter(([, member]) => member).map(([id]) => id)).toEqual([`${SRS_TIME_GROUP_PREFIX}25`]);
  });

  it('is idempotent: repeating the same entitlement changes nothing', async () => {
    const result = await driver.setTimeAccommodation(target, 25);
    expect(result.changes).toBe(0);
  });

  it('moves the student when the entitlement changes', async () => {
    await driver.setTimeAccommodation(target, 41.67);

    const membership = await srsMembership();
    expect(membership[`${SRS_TIME_GROUP_PREFIX}25`]).toBe(false);
    expect(membership[`${SRS_TIME_GROUP_PREFIX}41.67`]).toBe(true);
  });

  it('removes the student from every SRS group at 0', async () => {
    await driver.setTimeAccommodation(target, 0);

    const membership = await srsMembership();
    expect(Object.values(membership).every((member) => !member)).toBe(true);
  });

  it('rejects an unknown student as a driver error', async () => {
    await expect(driver.setTimeAccommodation({ vleCourseId: courseId!, personId: '00000000-0000-4000-8000-000000000000' }, 25))
      .rejects.toThrow(/no user/);
  });
});
