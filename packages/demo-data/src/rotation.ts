import { eq } from 'drizzle-orm';
import { createDb, demoStatus } from '@revelation-srs/db';

import { SCENARIO_REGISTRY } from './manifest.js';
import { resetScenario } from './reset.js';

// Standard-demo scenarios rotated on the daily schedule.
const DAILY_SLUGS: readonly string[] = [
  'curriculum-baseline',
  'applicant-pipeline',
  'enrolment-induction',
  'module-selection',
  'assessment-marks',
  'exam-board',
];

const WEEKLY_SLUG = 'institution-year';
const DAY_MS      = 86_400_000;
const WEEK_MS     = 7 * DAY_MS;

/**
 * Return the scenario slug that should be loaded for the given mode and date.
 *
 * Precedence:
 * 1. DEMO_FORCE_SCENARIO env var — operator override, validated against the registry.
 * 2. 'weekly' mode → 'institution-year'.
 * 3. 'daily' mode  → cycles through DAILY_SLUGS by UTC epoch-day number.
 */
export function selectNextScenario(mode: 'daily' | 'weekly', date?: Date): string {
  const forced = process.env['DEMO_FORCE_SCENARIO'];
  if (forced) {
    if (!SCENARIO_REGISTRY.has(forced)) {
      throw new Error(`DEMO_FORCE_SCENARIO "${forced}" is not a registered scenario slug.`);
    }
    return forced;
  }

  if (mode === 'weekly') return WEEKLY_SLUG;

  const d        = date ?? new Date();
  const epochDay = Math.floor(d.getTime() / DAY_MS);
  const idx      = epochDay % DAILY_SLUGS.length;
  return DAILY_SLUGS[idx] ?? (DAILY_SLUGS[0] as string);
}

export interface RotationResult {
  scenario:    string;
  skipped:     boolean;
  skipReason?: string | undefined;
  dryRun:      boolean;
}

/**
 * Execute one rotation cycle: select and load the appropriate scenario.
 *
 * Respects:
 *   DEMO_ROTATION_PAUSED=true  — skip the load unless DEMO_FORCE_SCENARIO is also set.
 *   DEMO_FORCE_SCENARIO=<slug> — override the computed scenario.
 *
 * After a successful load, writes the next scheduled reset time to demo_status
 * so the demo banner can display a countdown.
 */
export async function runRotation(opts: {
  databaseUrl: string;
  tenantId:    string;
  mode:        'daily' | 'weekly';
  dryRun?:     boolean;
  date?:       Date;
}): Promise<RotationResult> {
  const slug   = selectNextScenario(opts.mode, opts.date);
  const paused = process.env['DEMO_ROTATION_PAUSED'] === 'true';
  const forced = Boolean(process.env['DEMO_FORCE_SCENARIO']);

  if (paused && !forced) {
    console.log(`[demo:rotate] Rotation paused (DEMO_ROTATION_PAUSED=true) — skipping`);
    return { scenario: slug, skipped: true, skipReason: 'DEMO_ROTATION_PAUSED=true', dryRun: opts.dryRun ?? false };
  }

  if (opts.dryRun) {
    console.log(`[demo:rotate] Dry run — would load: ${slug} (mode=${opts.mode})`);
    return { scenario: slug, skipped: false, dryRun: true };
  }

  console.log(`[demo:rotate] Starting rotation: ${slug} (mode=${opts.mode})`);
  const startMs = Date.now();

  await resetScenario({
    databaseUrl:  opts.databaseUrl,
    tenantId:     opts.tenantId,
    scenarioSlug: slug,
  });

  // Stamp the next scheduled reset so the banner can show a countdown.
  const intervalMs  = opts.mode === 'weekly' ? WEEK_MS : DAY_MS;
  const nextResetAt = new Date(Date.now() + intervalMs);
  const db          = createDb(opts.databaseUrl);
  await db
    .update(demoStatus)
    .set({ nextResetAt })
    .where(eq(demoStatus.tenantId, opts.tenantId));

  const elapsed = Date.now() - startMs;
  console.log(
    `[demo:rotate] Completed: ${slug} in ${(elapsed / 1000).toFixed(1)}s` +
    ` — next reset at ${nextResetAt.toISOString()}`,
  );

  return { scenario: slug, skipped: false, dryRun: false };
}
