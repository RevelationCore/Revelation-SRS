/**
 * Platform-specific adjustment drivers (unit): the arithmetic every platform
 * shares, and the exact requests the Canvas and Moodle drivers send, checked
 * against a fake fetch that plays the platform.
 */
import { describe, expect, it } from 'vitest';

import { CanvasDriver, canvasObjectId, nextLink } from '../src/vle-platforms/canvas-driver.js';
import { MoodleDriver } from '../src/vle-platforms/moodle-driver.js';
import { createPlatformDriver } from '../src/vle-platforms/index.js';
import {
  combinedExtraTimePercent,
  extraMinutesFor,
  formatPercent,
  percentOfDuration,
} from '../src/vle-platforms/time-accommodation.js';

// ── Arithmetic ────────────────────────────────────────────────────────────────

describe('time accommodation arithmetic', () => {
  it('converts units to a percentage of duration', () => {
    expect(percentOfDuration({ value: 25, unitCode: 'percent-of-duration' })).toBe(25);
    expect(percentOfDuration({ value: 15, unitCode: 'minutes-per-hour' })).toBe(25);
    expect(percentOfDuration({ value: 7, unitCode: 'days' })).toBeNull();
  });

  it('adds a student\'s time adjustments together and ignores others', () => {
    expect(combinedExtraTimePercent([
      { distributionId: 'a', adjustmentTypeCode: 'extra-time',  amount: { value: 25, unitCode: 'percent-of-duration' } },
      { distributionId: 'b', adjustmentTypeCode: 'rest-breaks', amount: { value: 10, unitCode: 'minutes-per-hour' } },
      { distributionId: 'c', adjustmentTypeCode: 'deadline-extension', amount: { value: 7, unitCode: 'days' } },
      { distributionId: 'd', adjustmentTypeCode: 'extra-time',  amount: null },
    ])).toBe(41.67);
  });

  it('rounds extra minutes up so the entitlement is never short (AJ-21: 120 → +30)', () => {
    expect(extraMinutesFor(120, 25)).toBe(30);
    expect(extraMinutesFor(45, 25)).toBe(12);   // 11.25
    expect(extraMinutesFor(60, 41.67)).toBe(26); // 25.002
    expect(extraMinutesFor(90, 0)).toBe(0);
  });

  it('labels percentages without trailing zeros', () => {
    expect(formatPercent(25)).toBe('25');
    expect(formatPercent(16.666)).toBe('16.67');
  });
});

// ── Fake platform ─────────────────────────────────────────────────────────────

interface Call { method: string; url: string; body: unknown; headers: Record<string, string> }

function fakeFetch(routes: (call: Call) => { status?: number; body?: unknown; headers?: Record<string, string> } | undefined) {
  const calls: Call[] = [];
  const impl = (input: string, init: RequestInit = {}): Promise<Response> => {
    const raw = typeof init.body === 'string' ? init.body : undefined;
    const contentType = (init.headers as Record<string, string> | undefined)?.['content-type'] ?? '';
    const body = raw === undefined ? undefined
      : contentType.includes('json') ? JSON.parse(raw) as unknown
      : Object.fromEntries(new URLSearchParams(raw));
    const call: Call = { method: init.method ?? 'GET', url: input, body, headers: (init.headers ?? {}) as Record<string, string> };
    calls.push(call);
    const r = routes(call);
    if (!r) return Promise.resolve(new Response('not found', { status: 404 }));
    return Promise.resolve(new Response(r.body === undefined ? '' : JSON.stringify(r.body), {
      status: r.status ?? 200,
      headers: { 'content-type': 'application/json', ...(r.headers ?? {}) },
    }));
  };
  return { impl, calls };
}

// ── Canvas ───────────────────────────────────────────────────────────────────

const CANVAS = 'https://canvas.test';

describe('CanvasDriver', () => {
  function canvas(opts: { newQuizzes?: unknown[] | null; failNewQuiz?: boolean } = {}) {
    return fakeFetch((c) => {
      const path = c.url.replace(CANVAS, '');
      if (c.method === 'GET' && path === '/api/v1/users/sis_user_id:person-1') return { body: { id: 501 } };
      if (c.method === 'GET' && path === '/api/v1/courses/sis_course_id:LAW%20301/quizzes?per_page=100') {
        return {
          body: [{ id: 11, time_limit: 120 }, { id: 12, time_limit: null }],
          headers: { link: `<${CANVAS}/api/v1/courses/x/quizzes?page=2>; rel="next", <${CANVAS}/a>; rel="last"` },
        };
      }
      if (c.method === 'GET' && path === '/api/v1/courses/x/quizzes?page=2') return { body: [{ id: 13, time_limit: 45 }] };
      if (c.method === 'GET' && path === '/api/quiz/v1/courses/sis_course_id:LAW%20301/quizzes') {
        return opts.newQuizzes === null ? undefined : {
          body: opts.newQuizzes ?? [
            { id: 21, quiz_settings: { has_time_limit: true, session_time_limit_in_seconds: 3600 } },
            { id: 22, quiz_settings: { has_time_limit: false, session_time_limit_in_seconds: null } },
            { id: 23, quiz_settings: null },
          ],
        };
      }
      if (c.method === 'POST' && /\/quizzes\/\d+\/extensions$/.test(path)) return { body: { quiz_extensions: [] } };
      if (c.method === 'POST' && /\/quizzes\/\d+\/accommodations$/.test(path)) {
        return { body: opts.failNewQuiz
          ? { message: 'x', successful: [], failed: [{ user_id: 501, error: 'not enrolled' }] }
          : { message: 'ok', successful: [{ user_id: 501 }], failed: [] } };
      }
      return undefined;
    });
  }

  it('sets per-quiz extra minutes on every timed Classic quiz and New Quiz, across pages', async () => {
    const { impl, calls } = canvas();
    const driver = new CanvasDriver(CANVAS, 'tok', impl);

    const result = await driver.setTimeAccommodation({ vleCourseId: 'sis_course_id:LAW 301', personId: 'person-1' }, 25);

    expect(result.changes).toBe(3);
    const posts = calls.filter((c) => c.method === 'POST').map((c) => ({ path: c.url.replace(CANVAS, ''), body: c.body }));
    expect(posts).toEqual([
      { path: '/api/v1/courses/sis_course_id:LAW%20301/quizzes/11/extensions', body: { quiz_extensions: [{ user_id: 501, extra_time: 30 }] } },
      { path: '/api/v1/courses/sis_course_id:LAW%20301/quizzes/13/extensions', body: { quiz_extensions: [{ user_id: 501, extra_time: 12 }] } },
      { path: '/api/quiz/v1/courses/sis_course_id:LAW%20301/quizzes/21/accommodations', body: [{ user_id: 501, extra_time: 15 }] },
    ]);
    expect(calls.every((c) => c.headers['authorization'] === 'Bearer tok')).toBe(true);
  });

  it('clears by writing extra_time 0, and caches the user lookup', async () => {
    const { impl, calls } = canvas();
    const driver = new CanvasDriver(CANVAS, 'tok', impl);
    const target = { vleCourseId: 'sis_course_id:LAW 301', personId: 'person-1' };

    await driver.setTimeAccommodation(target, 25);
    await driver.setTimeAccommodation(target, 0);

    const lastClassic = calls.filter((c) => c.url.endsWith('/quizzes/11/extensions')).at(-1);
    expect(lastClassic?.body).toEqual({ quiz_extensions: [{ user_id: 501, extra_time: 0 }] });
    expect(calls.filter((c) => c.url.includes('/users/'))).toHaveLength(1);
  });

  it('treats a course without New Quizzes (404) as having none', async () => {
    const { impl } = canvas({ newQuizzes: null });
    const result = await new CanvasDriver(CANVAS, 'tok', impl)
      .setTimeAccommodation({ vleCourseId: 'sis_course_id:LAW 301', personId: 'person-1' }, 25);
    expect(result.changes).toBe(2);
  });

  it('fails when Canvas reports the accommodation as failed', async () => {
    const { impl } = canvas({ failNewQuiz: true });
    await expect(new CanvasDriver(CANVAS, 'tok', impl)
      .setTimeAccommodation({ vleCourseId: 'sis_course_id:LAW 301', personId: 'person-1' }, 25))
      .rejects.toThrow(/not enrolled/);
  });

  it('fails when the student has no Canvas account', async () => {
    const { impl } = canvas();
    await expect(new CanvasDriver(CANVAS, 'tok', impl)
      .setTimeAccommodation({ vleCourseId: '42', personId: 'unknown' }, 25))
      .rejects.toThrow(/404/);
  });

  it('encodes ids and follows Link headers', () => {
    expect(canvasObjectId('123')).toBe('123');
    expect(canvasObjectId('sis_course_id:A/B 1')).toBe('sis_course_id:A%2FB%201');
    expect(nextLink('<https://x/p2>; rel="next", <https://x/p9>; rel="last"')).toBe('https://x/p2');
    expect(nextLink('<https://x/p9>; rel="last"')).toBeNull();
    expect(nextLink(null)).toBeNull();
  });
});

// ── Moodle ───────────────────────────────────────────────────────────────────

const MOODLE = 'https://moodle.test';

describe('MoodleDriver', () => {
  function moodle(state: { groups: Array<{ id: number; courseid: number; name: string; idnumber: string }>; members: Record<number, number[]> }) {
    let nextId = 900;
    return fakeFetch((c) => {
      const p = c.body as Record<string, string>;
      if (c.url !== `${MOODLE}/webservice/rest/server.php` || p['wstoken'] !== 'wstok' || p['moodlewsrestformat'] !== 'json') return undefined;
      switch (p['wsfunction']) {
        case 'core_user_get_users_by_field':
          return { body: p['field'] === 'idnumber' && p['values[0]'] === 'person-1' ? [{ id: 77 }] : [] };
        case 'core_group_get_course_groups':
          return { body: state.groups.filter((g) => String(g.courseid) === p['courseid']) };
        case 'core_group_create_groups': {
          const g = { id: nextId++, courseid: Number(p['groups[0][courseid]']), name: p['groups[0][name]']!, idnumber: p['groups[0][idnumber]']! };
          state.groups.push(g);
          return { body: [g] };
        }
        case 'core_group_get_group_members': {
          const ids = Object.entries(p).filter(([k]) => k.startsWith('groupids[')).map(([, v]) => Number(v));
          return { body: ids.map((id) => ({ groupid: id, userids: state.members[id] ?? [] })) };
        }
        case 'core_group_add_group_members': {
          const g = Number(p['members[0][groupid]']);
          state.members[g] = [...(state.members[g] ?? []), Number(p['members[0][userid]'])];
          return { body: null };
        }
        case 'core_group_delete_group_members': {
          const g = Number(p['members[0][groupid]']);
          state.members[g] = (state.members[g] ?? []).filter((u) => u !== Number(p['members[0][userid]']));
          return { body: null };
        }
        default:
          return { body: { exception: 'webservice_access_exception', errorcode: 'accessexception', message: 'Access control exception' } };
      }
    });
  }

  it('creates the group for the entitlement and adds the student', async () => {
    const state = { groups: [] as Array<{ id: number; courseid: number; name: string; idnumber: string }>, members: {} as Record<number, number[]> };
    const { impl } = moodle(state);

    const result = await new MoodleDriver(MOODLE, 'wstok', impl).setTimeAccommodation({ vleCourseId: '12', personId: 'person-1' }, 25);

    expect(state.groups).toEqual([{ id: 900, courseid: 12, name: 'Extra time +25% (SRS)', idnumber: 'srs-extra-time-25' }]);
    expect(state.members[900]).toEqual([77]);
    expect(result.changes).toBe(1);
  });

  it('moves the student between SRS groups when the entitlement changes, leaving other groups alone', async () => {
    const state = {
      groups: [
        { id: 1, courseid: 12, name: 'Seminar A', idnumber: 'seminar-a' },
        { id: 2, courseid: 12, name: 'Extra time +25% (SRS)', idnumber: 'srs-extra-time-25' },
        { id: 3, courseid: 12, name: 'Extra time +41.67% (SRS)', idnumber: 'srs-extra-time-41.67' },
      ],
      members: { 1: [77], 2: [77] } as Record<number, number[]>,
    };
    const { impl } = moodle(state);

    await new MoodleDriver(MOODLE, 'wstok', impl).setTimeAccommodation({ vleCourseId: '12', personId: 'person-1' }, 41.67);

    expect(state.members).toEqual({ 1: [77], 2: [], 3: [77] });
  });

  it('removes the student from SRS groups when the entitlement is 0, and is a no-op when repeated', async () => {
    const state = {
      groups: [{ id: 2, courseid: 12, name: 'Extra time +25% (SRS)', idnumber: 'srs-extra-time-25' }],
      members: { 2: [77, 88] } as Record<number, number[]>,
    };
    const { impl } = moodle(state);
    const driver = new MoodleDriver(MOODLE, 'wstok', impl);

    expect((await driver.setTimeAccommodation({ vleCourseId: '12', personId: 'person-1' }, 0)).changes).toBe(1);
    expect((await driver.setTimeAccommodation({ vleCourseId: '12', personId: 'person-1' }, 0)).changes).toBe(0);
    expect(state.members[2]).toEqual([88]);
  });

  it('treats a Moodle exception body as a failure', async () => {
    const { impl } = fakeFetch(() => ({ body: { exception: 'moodle_exception', errorcode: 'invalidtoken', message: 'Invalid token' } }));
    await expect(new MoodleDriver(MOODLE, 'bad', impl).setTimeAccommodation({ vleCourseId: '12', personId: 'person-1' }, 25))
      .rejects.toThrow(/invalidtoken/);
  });

  it('fails when the student has no Moodle account', async () => {
    const { impl } = moodle({ groups: [], members: {} });
    await expect(new MoodleDriver(MOODLE, 'wstok', impl).setTimeAccommodation({ vleCourseId: '12', personId: 'nobody' }, 25))
      .rejects.toThrow(/no user/);
  });
});

describe('createPlatformDriver', () => {
  it('requires a token for real platforms', () => {
    expect(createPlatformDriver('stub', 'http://x', undefined).platform).toBe('stub');
    expect(() => createPlatformDriver('canvas', 'http://x', undefined)).toThrow(/VLE_API_TOKEN/);
    expect(createPlatformDriver('moodle', 'http://x', 't').platform).toBe('moodle');
  });
});
