import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { test, expect, type Locator, type Page } from '@playwright/test';

import { TIMING, pause } from './timing.js';
import { installVisualPolish, smoothScrollIntoView } from './visual-polish.js';

// This spec drives the real, running application (real Keycloak OIDC
// login, real API writes) to produce the source recording for the
// overview tutorial video described in docs/tutorial-video/. It follows
// docs/tutorial-video/overview-storyboard.md scene-for-scene (scenes 2-9 —
// the title/closing cards, scenes 1 and 10, are synthetic and added later
// by tutorials/scripts/build-overview-video.mjs).
//
// Prerequisites (see tutorials/README.md):
//   - the API and portal dev servers running (tutorials/setup/ensure-app-running.mjs)
//   - the "module-selection" demo scenario freshly reset with the
//     alice.demo Keycloak persona provisioned (tutorials/setup/prepare-tutorial-data.mjs)
//
// Run at full tutorial pacing:   pnpm tutorial:record
// Run in fast verification mode: pnpm tutorial:test   (sets TUTORIAL_FAST=1)

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CHECKPOINT_DIR = path.resolve(HERE, '..', 'generated', 'checkpoints');

const DEMO_USERNAME = process.env['TUTORIAL_DEMO_USERNAME'] ?? 'alice.demo';
const DEMO_PASSWORD = process.env['TUTORIAL_DEMO_PASSWORD'] ?? 'Demo-2026!';

async function checkpoint(page: Page, name: string): Promise<void> {
  await fs.mkdir(CHECKPOINT_DIR, { recursive: true });
  await page.screenshot({ path: path.join(CHECKPOINT_DIR, `${name}.png`) });
}

// Fails with a clear, specific message (rather than a generic timeout)
// when a screen or control the storyboard depends on isn't there.
async function requireVisible(locator: Locator, description: string): Promise<void> {
  await expect(locator, `Expected to find ${description} — the storyboard step that needs it cannot continue`).toBeVisible({
    timeout: 15_000,
  });
}

test.describe('overview tutorial recording', () => {
  test.setTimeout(180_000);

  test('records the student portal module registration journey', async ({ page }) => {
    // Phase 9 quality check: fail the recording immediately on an
    // uncaught application error rather than silently producing a video
    // of a broken page.
    const consoleErrors: string[] = [];
    page.on('pageerror', (error) => {
      throw new Error(`Unexpected application error during recording: ${error.message}`);
    });
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await installVisualPolish(page);

    // ── scene-02: what the app is for (login page) ──────────────────────
    await page.goto('/login');
    const signInButton = page.getByRole('button', { name: /sign in with institutional account/i });
    await requireVisible(signInButton, 'the "Sign in with institutional account" button on the login page');
    await pause(page, TIMING.readingPause);
    await signInButton.click();

    // ── real Keycloak OIDC login ─────────────────────────────────────────
    await page.waitForURL(/realms\/srs/, { timeout: 20_000 });
    const usernameField = page.locator('#username');
    const passwordField = page.locator('#password');
    await requireVisible(usernameField, 'the Keycloak username field');
    await usernameField.pressSequentially(DEMO_USERNAME, { delay: TIMING.typingDelay });
    await pause(page, TIMING.shortPause);
    await passwordField.pressSequentially(DEMO_PASSWORD, { delay: TIMING.typingDelay });
    await pause(page, TIMING.shortPause);
    await page.locator('#kc-login').click();

    // ── scene-03: interface orientation (dashboard) ──────────────────────
    await page.waitForURL(/\/dashboard/, { timeout: 20_000 });
    await requireVisible(page.getByRole('heading', { name: /enrolments/i }), 'the dashboard enrolments section');
    await pause(page, TIMING.importantPause);
    await checkpoint(page, 'scene-03-dashboard');

    // ── scene-04: starting the main workflow (My modules) ────────────────
    const nav = page.getByRole('navigation', { name: 'Main' });
    const myModulesLink = nav.getByRole('link', { name: 'My modules' });
    await requireVisible(myModulesLink, 'the "My modules" navigation link');
    await myModulesLink.click();
    await page.waitForURL(/\/modules$/);
    await requireVisible(page.getByRole('table'), 'the current module registrations table on My modules');
    await pause(page, TIMING.readingPause);
    await checkpoint(page, 'scene-04-my-modules-before');

    // ── scene-05: browsing and selecting a module ────────────────────────
    const addModuleLink = page.getByRole('link', { name: /add module/i });
    await requireVisible(addModuleLink, 'the "Add module" link on My modules');
    await addModuleLink.click();
    await page.waitForURL(/\/modules\/add$/);
    const offeringsTable = page.getByRole('table');
    await requireVisible(offeringsTable, 'the available module offerings table on Add module');
    await pause(page, TIMING.readingPause);

    const calculusRow = page.getByRole('row', { name: /Calculus/i });
    await requireVisible(calculusRow, 'the MA101 Calculus module offering row');
    await smoothScrollIntoView(calculusRow);
    await checkpoint(page, 'scene-05-browse-modules');

    // ── scene-06: demonstrating the confirm step ─────────────────────────
    const registerButton = calculusRow.getByRole('button', { name: /add module/i });
    await requireVisible(registerButton, 'the "Add module" button on the Calculus row');
    await registerButton.click();
    const confirmButton = calculusRow.getByRole('button', { name: /confirm/i });
    await requireVisible(confirmButton, 'the inline confirmation control after clicking Add module');
    await pause(page, TIMING.importantPause);
    await checkpoint(page, 'scene-06-confirm-prompt');

    // ── scene-07: submitting the registration ────────────────────────────
    await confirmButton.click();
    // The application does not navigate away or show a toast here — this
    // pause is deliberate (see docs/tutorial-video/application-analysis.md,
    // "No automatic on-screen confirmation after registering").
    await pause(page, TIMING.importantPause);

    // ── scene-08: showing the result ─────────────────────────────────────
    await myModulesLink.click();
    await page.waitForURL(/\/modules$/);
    const newRegistrationRow = page.getByRole('row', { name: /Calculus/i });
    await requireVisible(newRegistrationRow, 'the newly registered MA101 Calculus row on My modules');
    await smoothScrollIntoView(newRegistrationRow);
    await pause(page, TIMING.importantPause);
    await checkpoint(page, 'scene-08-registration-confirmed');

    // ── scene-09: brief tour of secondary features ───────────────────────
    const notificationsLink = nav.getByRole('link', { name: 'Notifications' });
    await requireVisible(notificationsLink, 'the "Notifications" navigation link');
    await notificationsLink.click();
    await page.waitForURL(/\/notifications$/);
    await pause(page, TIMING.readingPause);
    await checkpoint(page, 'scene-09-notifications');

    const timetableLink = nav.getByRole('link', { name: 'Timetable' });
    await requireVisible(timetableLink, 'the "Timetable" navigation link');
    await timetableLink.click();
    await page.waitForURL(/\/timetable$/);
    await pause(page, TIMING.readingPause);
    await checkpoint(page, 'scene-09-timetable');

    await fs.mkdir(CHECKPOINT_DIR, { recursive: true });
    await fs.writeFile(
      path.join(CHECKPOINT_DIR, 'console-errors.json'),
      JSON.stringify({ consoleErrorCount: consoleErrors.length, consoleErrors }, null, 2),
    );
  });
});
