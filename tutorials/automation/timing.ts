import type { Page } from '@playwright/test';

// Named timing constants for the tutorial recording — deliberately no
// random delays anywhere in this automation, per the task requirement.
// Values are tuned for a human viewer to comfortably follow along at
// normal recording speed.
export const TIMING = {
  shortPause: 600,
  readingPause: 1400,
  importantPause: 2500,
  typingDelay: 45,
};

// TUTORIAL_FAST=1 runs the same script structure at a much shorter pace,
// so the workflow itself can be verified without sitting through full
// tutorial pacing (e.g. in CI, or while iterating on the spec).
export const FAST_MODE = process.env['TUTORIAL_FAST'] === '1';

export function scaleDuration(ms: number): number {
  return FAST_MODE ? Math.min(120, Math.round(ms / 6)) : ms;
}

export async function pause(page: Page, ms: number): Promise<void> {
  await page.waitForTimeout(scaleDuration(ms));
}
