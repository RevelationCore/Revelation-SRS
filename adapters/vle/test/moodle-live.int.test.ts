/**
 * MoodleDriver against a real Moodle (infra/compose/moodle.compose.yml).
 *
 * Skipped unless MOODLE_URL, MOODLE_TOKEN, MOODLE_COURSE_ID and
 * MOODLE_PERSON_ID are set — infra/compose/moodle/setup.sh prints them. The
 * unit tests (vle-platforms.test.ts) check the requests against a fake; this
 * checks a real Moodle accepts them and ends in the intended state.
 */
import { describe, expect, it } from 'vitest';

import { MoodleDriver, SRS_OVERRIDE_REASON, SRS_TIME_GROUP_PREFIX } from '../src/vle-platforms/moodle-driver.js';

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

describe.skipIf(!configured)('MoodleDriver quiz-overrides strategy against a real Moodle', () => {
  const driver = new MoodleDriver(url!, token!, fetch, 'quiz-overrides');
  const target = { vleCourseId: courseId!, personId: personId! };

  interface Override { id: number; userid: number | null; timelimit: number | null; timeclose: number | null; reason: string | null }

  async function quizzesByName(): Promise<Record<string, { id: number; timelimit: number }>> {
    const { quizzes } = await ws<{ quizzes: Array<{ id: number; name: string; timelimit: number }> }>('mod_quiz_get_quizzes_by_courses', { 'courseids[0]': courseId! });
    return Object.fromEntries(quizzes.map((q) => [q.name, { id: q.id, timelimit: q.timelimit }]));
  }

  async function overrideFor(quizId: number): Promise<Override | undefined> {
    const [user] = await ws<Array<{ id: number }>>('core_user_get_users_by_field', { field: 'idnumber', 'values[0]': personId! });
    const { overrides } = await ws<{ overrides: Override[] }>('mod_quiz_get_overrides', { quizid: quizId });
    return overrides.find((o) => o.userid === user!.id);
  }

  it('gives the student the extra time on each timed quiz (60 min + 25% = 75)', async () => {
    await driver.setTimeAccommodation(target, 0);
    const result = await driver.setTimeAccommodation(target, 25);
    const q = await quizzesByName();

    const timed = await overrideFor(q['SRS timed quiz (60 min)']!.id);
    expect(timed).toMatchObject({ timelimit: 4500, reason: SRS_OVERRIDE_REASON });
    expect(await overrideFor(q['SRS untimed quiz']!.id)).toBeUndefined();
    expect(result.warnings).toEqual([expect.stringContaining('staff override')]);
  });

  it('leaves a staff override untouched', async () => {
    const q = await quizzesByName();
    const staff = await overrideFor(q['SRS quiz with staff override (30 min)']!.id);
    expect(staff).toMatchObject({ reason: 'Staff: deadline extension', timelimit: null });
    expect(staff!.timeclose).toBeGreaterThan(0);
  });

  it('is idempotent, and updates the limit when the entitlement changes (41.67% of 60 = +26)', async () => {
    expect((await driver.setTimeAccommodation(target, 25)).changes).toBe(0);

    await driver.setTimeAccommodation(target, 41.67);
    const q = await quizzesByName();
    expect((await overrideFor(q['SRS timed quiz (60 min)']!.id))?.timelimit).toBe(3600 + 26 * 60);
  });

  it('deletes only its own overrides at 0', async () => {
    await driver.setTimeAccommodation(target, 0);
    const q = await quizzesByName();
    expect(await overrideFor(q['SRS timed quiz (60 min)']!.id)).toBeUndefined();
    expect(await overrideFor(q['SRS quiz with staff override (30 min)']!.id)).toMatchObject({ reason: 'Staff: deadline extension' });
  });
});
