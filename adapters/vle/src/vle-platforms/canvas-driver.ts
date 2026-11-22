import { fetchWithTimeout } from '@revelation-srs/service-client';

import { extraMinutesFor } from './time-accommodation.js';
import {
  VlePlatformError,
  type AccommodationResult,
  type FetchLike,
  type PersonInCourse,
  type VlePlatformDriver,
} from './driver.js';

/**
 * Canvas LMS driver: per-quiz extra minutes.
 *
 * Canvas stores extra time per quiz per student, in minutes, so the driver
 * lists the course's timed quizzes and sets each one's extra time to the
 * student's percentage of that quiz's limit (rounded up):
 *
 *   Classic Quizzes  GET  /api/v1/courses/:course_id/quizzes            time_limit (minutes, null = untimed)
 *                    POST /api/v1/courses/:course_id/quizzes/:quiz_id/extensions
 *                         { quiz_extensions: [{ user_id, extra_time }] }  extra_time in minutes,
 *                         "will add to the existing time limit on the submission"
 *   New Quizzes      GET  /api/quiz/v1/courses/:course_id/quizzes        quiz_settings.has_time_limit,
 *                         quiz_settings.session_time_limit_in_seconds (seconds)
 *                    POST /api/quiz/v1/courses/:course_id/quizzes/:assignment_id/accommodations
 *                         [{ user_id, extra_time }]                       extra_time in minutes;
 *                         200 with { successful: [...], failed: [{ user_id, error }] }
 *
 * The student is resolved with GET /api/v1/users/sis_user_id:<personId>.
 * Canvas's course-level New Quizzes accommodation is NOT used: it takes one
 * figure in minutes for every quiz in the course, which cannot express a
 * percentage across quizzes of different lengths.
 *
 * Verify against a Canvas test instance before production use:
 *   - Removing an accommodation sends extra_time 0. Canvas does not document
 *     how to clear either kind; 0 is the natural reading but is unconfirmed.
 *   - Instructure's New Quizzes docs show both /api/quiz/v1/... and
 *     /api/v1/... for the accommodation routes; this uses /api/quiz/v1.
 *   - New Quizzes list responses may omit quiz_settings; such a quiz is
 *     treated as untimed (skipped).
 *   - Quizzes created after a sync get no accommodation until the next
 *     coverage reconciliation run (ReconciliationService.reconcileAdjustmentCoverage).
 */
export class CanvasDriver implements VlePlatformDriver {
  readonly platform = 'canvas' as const;
  readonly #userIds = new Map<string, number>();

  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    private readonly fetchImpl: FetchLike = fetchWithTimeout,
  ) {}

  async setTimeAccommodation(target: PersonInCourse, extraTimePercent: number): Promise<AccommodationResult> {
    const userId = await this.#resolveUserId(target.personId);
    const course = canvasObjectId(target.vleCourseId);
    let changes = 0;

    const classic = await this.#getAllPages<ClassicQuiz>(`/api/v1/courses/${course}/quizzes?per_page=100`);
    for (const quiz of classic) {
      if (typeof quiz.time_limit !== 'number' || quiz.time_limit <= 0) continue;
      await this.#request('POST', `/api/v1/courses/${course}/quizzes/${quiz.id}/extensions`, {
        quiz_extensions: [{ user_id: userId, extra_time: extraMinutesFor(quiz.time_limit, extraTimePercent) }],
      });
      changes += 1;
    }

    const newQuizzes = await this.#getAllPages<NewQuiz>(`/api/quiz/v1/courses/${course}/quizzes`, { notFoundIsEmpty: true });
    for (const quiz of newQuizzes) {
      const seconds = quiz.quiz_settings?.has_time_limit ? quiz.quiz_settings.session_time_limit_in_seconds : null;
      if (typeof seconds !== 'number' || seconds <= 0) continue;
      const response = await this.#request<AccommodationResponse>(
        'POST',
        `/api/quiz/v1/courses/${course}/quizzes/${quiz.id}/accommodations`,
        [{ user_id: userId, extra_time: extraMinutesFor(seconds / 60, extraTimePercent) }],
      );
      if (response?.failed && response.failed.length > 0) {
        throw new VlePlatformError(
          `Canvas rejected the accommodation for New Quiz ${quiz.id}: ${response.failed.map((f) => f.error).join('; ')}`,
          'canvas',
        );
      }
      changes += 1;
    }

    return { changes };
  }

  async #resolveUserId(personId: string): Promise<number> {
    const cached = this.#userIds.get(personId);
    if (cached !== undefined) return cached;
    const user = await this.#request<{ id: number }>('GET', `/api/v1/users/sis_user_id:${encodeURIComponent(personId)}`);
    if (!user || typeof user.id !== 'number') {
      throw new VlePlatformError(`Canvas has no user with SIS id ${personId}`, 'canvas', 404);
    }
    this.#userIds.set(personId, user.id);
    return user.id;
  }

  async #getAllPages<T>(path: string, opts: { notFoundIsEmpty?: boolean } = {}): Promise<T[]> {
    const items: T[] = [];
    let url: string | null = `${this.baseUrl}${path}`;
    while (url) {
      const res: Response = await this.fetchImpl(url, { headers: this.#headers() });
      if (res.status === 404 && opts.notFoundIsEmpty) return items;
      if (!res.ok) throw new VlePlatformError(`Canvas GET ${path} failed: ${res.status}`, 'canvas', res.status);
      const page = await res.json() as T[];
      items.push(...page);
      url = nextLink(res.headers.get('link'));
    }
    return items;
  }

  async #request<T = unknown>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T | null> {
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers: { ...this.#headers(), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    if (!res.ok) throw new VlePlatformError(`Canvas ${method} ${path} failed: ${res.status}`, 'canvas', res.status);
    const text = await res.text();
    return text ? JSON.parse(text) as T : null;
  }

  #headers(): Record<string, string> {
    return { authorization: `Bearer ${this.token}`, accept: 'application/json' };
  }
}

interface ClassicQuiz { id: number; time_limit: number | null }
interface NewQuiz {
  id: number | string;
  quiz_settings?: { has_time_limit?: boolean; session_time_limit_in_seconds?: number | null } | null;
}
interface AccommodationResponse { failed?: Array<{ user_id: number; error: string }> }

/** Canvas ids may be numeric or SIS-prefixed (sis_course_id:ABC); encode the id part only. */
export function canvasObjectId(id: string): string {
  const i = id.indexOf(':');
  return i > 0 ? `${id.slice(0, i)}:${encodeURIComponent(id.slice(i + 1))}` : encodeURIComponent(id);
}

/** RFC 8288 Link header: the rel="next" target, if any (Canvas pagination). */
export function nextLink(header: string | null): string | null {
  if (!header) return null;
  for (const part of header.split(',')) {
    const match = /<([^>]+)>\s*;\s*rel="?next"?/.exec(part.trim());
    if (match) return match[1] ?? null;
  }
  return null;
}
