import { fetchWithTimeout } from '@revelation-srs/service-client';

import { CanvasDriver } from './canvas-driver.js';
import type { VlePlatform, VlePlatformDriver } from './driver.js';
import { MoodleDriver, type MoodleStrategy } from './moodle-driver.js';
import { StubVleDriver } from './stub-driver.js';

export * from './driver.js';
export * from './time-accommodation.js';
export { CanvasDriver } from './canvas-driver.js';
export { MoodleDriver } from './moodle-driver.js';
export { StubVleDriver } from './stub-driver.js';

export function createPlatformDriver(
  platform: VlePlatform,
  baseUrl: string,
  apiToken: string | undefined,
  opts: { moodleStrategy?: MoodleStrategy } = {},
): VlePlatformDriver {
  switch (platform) {
    case 'stub':
      return new StubVleDriver(baseUrl);
    case 'canvas':
    case 'moodle':
      if (!apiToken) throw new Error(`VLE_API_TOKEN is required for VLE_PLATFORM=${platform}`);
      return platform === 'canvas'
        ? new CanvasDriver(baseUrl, apiToken)
        : new MoodleDriver(baseUrl, apiToken, fetchWithTimeout, opts.moodleStrategy ?? 'quiz-overrides');
  }
}
