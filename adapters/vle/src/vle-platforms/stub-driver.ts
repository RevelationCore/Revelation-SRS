import { fetchWithTimeout } from '../http/fetch-with-timeout.js';

import { VlePlatformError, type AccommodationResult, type FetchLike, type PersonInCourse, type VlePlatformDriver } from './driver.js';

/** Driver for the in-process stub VLE (src/stub-vle). */
export class StubVleDriver implements VlePlatformDriver {
  readonly platform = 'stub' as const;

  constructor(
    private readonly baseUrl: string,
    private readonly fetchImpl: FetchLike = fetchWithTimeout,
  ) {}

  async setTimeAccommodation(target: PersonInCourse, extraTimePercent: number): Promise<AccommodationResult> {
    const url = `${this.baseUrl}/stub/courses/${encodeURIComponent(target.vleCourseId)}/time-accommodations/${encodeURIComponent(target.personId)}`;
    const res = extraTimePercent > 0
      ? await this.fetchImpl(url, {
          method:  'PUT',
          headers: { 'content-type': 'application/json' },
          body:    JSON.stringify({ extraTimePercent }),
        })
      : await this.fetchImpl(url, { method: 'DELETE' });

    if (!res.ok && !(extraTimePercent <= 0 && res.status === 404)) {
      throw new VlePlatformError(`Stub VLE time accommodation failed: ${res.status}`, 'stub', res.status);
    }
    return { changes: 1 };
  }
}
