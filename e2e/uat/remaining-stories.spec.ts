/**
 * Assisted UAT suite — remaining UAT Round 1 stories.
 *
 * Unlike the golden-path and smoke suites, these tests run against the LIVE API
 * and a demo-seeded database (not mocked API responses). They are intended to
 * find the same classes of problem already seen in UAT Round 1: 403s, 500s,
 * missing seeded data, broken navigation, and obvious form submission failures.
 *
 * Prerequisites:
 *   1. The API server must be running (pnpm --filter @revelation-srs/api dev).
 *   2. The demo database must be loaded with the appropriate scenario before
 *      each story block (pnpm demo:reset <scenario-slug>).
 *   3. The admin and portal dev servers must be running (handled by webServer in
 *      playwright.config.ts).
 *
 * Findings are written to docs/uat1/reports/automated-uat-findings-YYYY-MM-DD.md
 * after the full suite completes. Review findings and raise GitHub issues manually
 * using the UAT bug template rather than trusting automation alone.
 *
 * Stories with knownGaps document placeholder steps. Those gaps are not treated
 * as test failures — they are recorded in the findings file as informational notes.
 */
/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call */

import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

import { PERSONAS, ADMIN, injectPersona, appBase } from './personas.js';
import { MANIFEST, type StoryEntry, type Check } from './remaining-stories.manifest.js';
import { type Finding, writeReport } from './findings-reporter.js';

// ── Findings accumulator ──────────────────────────────────────────────────────

const allFindings: Finding[] = [];

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Collect 4xx/5xx responses during a page navigation. */
async function collectHttpErrors(page: Page, action: () => Promise<void>): Promise<string[]> {
  const errors: string[] = [];
  const listener = (response: { status: () => number; url: () => string }) => {
    const status = response.status();
    const url    = response.url();
    // Ignore non-API requests (static assets, etc.)
    if (url.includes('/api/') && (status >= 400)) {
      errors.push(`HTTP ${status} on ${url}`);
    }
  };
  page.on('response', listener);
  await action();
  page.off('response', listener);
  return errors;
}

/** Collect severe console errors during a page navigation. */
async function collectConsoleErrors(page: Page, action: () => Promise<void>): Promise<string[]> {
  const errors: string[] = [];
  const listener = (msg: { type: () => string; text: () => string }) => {
    if (msg.type() === 'error') {
      const text = msg.text();
      // Ignore noise from browser extensions and favicon 404s
      if (!text.includes('favicon') && !text.includes('chrome-extension')) {
        errors.push(text);
      }
    }
  };
  page.on('console', listener);
  await action();
  page.off('console', listener);
  return errors;
}

async function runCheck(page: Page, check: Check, url: string): Promise<string | null> {
  switch (check.type) {
    case 'heading': {
      try {
        await expect(page.getByRole('heading', { name: new RegExp(check.value!, 'i') }))
          .toBeVisible({ timeout: 5_000 });
        return null;
      } catch {
        return `Expected heading matching /${check.value}/i but it was not found`;
      }
    }
    case 'text': {
      try {
        await expect(page.getByText(new RegExp(check.value!, 'i'))).toBeVisible({ timeout: 5_000 });
        return null;
      } catch {
        return `Expected text matching /${check.value}/i but it was not found`;
      }
    }
    case 'table-rows': {
      try {
        const rows = await page.locator('table tbody tr').count();
        if (rows < (check.minRows ?? 1)) {
          return `Expected at least ${check.minRows ?? 1} table row(s) but found ${rows}`;
        }
        return null;
      } catch {
        return `Could not count table rows at ${url}`;
      }
    }
    case 'axe': {
      try {
        const results = await new AxeBuilder({ page })
          .disableRules(['color-contrast']) // colour tokens verified separately
          .analyze();
        if (results.violations.length > 0) {
          const ids = results.violations.map((v: { id: string }) => v.id).join(', ');
          return `${results.violations.length} axe violation(s): ${ids}`;
        }
        return null;
      } catch {
        return 'axe scan threw an error';
      }
    }
    // HTTP and console error checks are handled outside runCheck (see collectHttpErrors/
    // collectConsoleErrors) and injected as findings directly — not returned here.
    default:
      return null;
  }
}

// ── Test generation ───────────────────────────────────────────────────────────

// Group by scenario to make the output readable and to signal which scenario
// should be reset before each group.
const byScenario = new Map<string, StoryEntry[]>();
for (const story of MANIFEST) {
  const group = byScenario.get(story.scenario) ?? [];
  group.push(story);
  byScenario.set(story.scenario, group);
}

for (const [scenario, stories] of byScenario) {
  test.describe(`Scenario: ${scenario}`, () => {
    for (const story of stories) {
      test(`${story.storyId} — ${story.title}`, async ({ page }) => {
        const persona = PERSONAS[story.persona];
        const base    = appBase(persona);

        // Inject persona JWT before navigation
        await injectPersona(page, persona);

        const storyFindings: Finding[] = [];

        // Navigate and collect HTTP errors
        const httpErrors = await collectHttpErrors(page, async () => {
          const consoleErrors = await collectConsoleErrors(page, async () => {
            await page.goto(`${base}${story.startUrl}`, { waitUntil: 'networkidle', timeout: 15_000 });
          });
          // Record console errors as Medium findings
          for (const ce of consoleErrors) {
            storyFindings.push({
              storyId:  story.storyId,
              title:    story.title,
              scenario: story.scenario,
              persona:  story.persona,
              severity: 'Medium',
              url:      `${base}${story.startUrl}`,
              expected: 'No console errors',
              actual:   ce,
              evidence: [],
            });
          }
        });

        // Record HTTP errors as High findings
        for (const he of httpErrors) {
          storyFindings.push({
            storyId:  story.storyId,
            title:    story.title,
            scenario: story.scenario,
            persona:  story.persona,
            severity: 'High',
            url:      `${base}${story.startUrl}`,
            expected: 'API returns 2xx',
            actual:   he,
            evidence: [],
          });
        }

        // Run individual checks
        for (const check of story.checks) {
          if (check.type === 'no-http-error' || check.type === 'no-console-error') continue;
          const failure = await runCheck(page, check, `${base}${story.startUrl}`);
          if (failure) {
            storyFindings.push({
              storyId:  story.storyId,
              title:    story.title,
              scenario: story.scenario,
              persona:  story.persona,
              severity: check.type === 'axe' ? 'Low' : 'Medium',
              url:      `${base}${story.startUrl}`,
              expected: `Check: ${check.type}${check.value ? ` (${check.value})` : ''}`,
              actual:   failure,
              evidence: [],
            });
          }
        }

        allFindings.push(...storyFindings);

        // Log known gaps as informational output, not failures
        if (story.knownGaps && story.knownGaps.length > 0) {
          console.info(`[${story.storyId}] Known gaps:`, story.knownGaps.join('; '));
        }

        // Only fail the test on HTTP errors (High severity).
        // Medium/Low issues are recorded in the findings report but do not block CI.
        const highFindings = storyFindings.filter(f => f.severity === 'High');
        if (highFindings.length > 0) {
          const messages = highFindings.map(f => `${f.actual}`).join('\n');
          throw new Error(`${story.storyId} has ${highFindings.length} High-severity finding(s):\n${messages}`);
        }
      });
    }
  });
}

// ── Write findings report after all tests ─────────────────────────────────────

test.afterAll(async () => {
  if (allFindings.length > 0) {
    const outPath = writeReport(allFindings);
    console.info(`\nFindings written to: ${outPath}`);
  }
});
