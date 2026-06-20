import { eq, and, sql } from 'drizzle-orm';
import { demoStatus, demoLoadCheckpoints, type Db } from '@revelation-srs/db';

import type { ScenarioManifest, LoadPhase } from './types.js';

type ScenarioLoader = (db: Db, tenantId: string, phase: string, opts: { dryRun?: boolean }) => Promise<void>;

function phaseIndex(phases: readonly LoadPhase[], phase: LoadPhase): number {
  return phases.indexOf(phase);
}

async function getCheckpoint(
  db: Db,
  tenantId: string,
  scenarioSlug: string,
): Promise<string | undefined> {
  const rows = await db
    .select({ phaseName: demoLoadCheckpoints.phaseName })
    .from(demoLoadCheckpoints)
    .where(
      and(
        eq(demoLoadCheckpoints.tenantId, tenantId),
        eq(demoLoadCheckpoints.scenarioSlug, scenarioSlug),
      ),
    )
    .limit(1);

  return rows[0]?.phaseName;
}

async function commitCheckpoint(
  db: Db,
  tenantId: string,
  scenarioSlug: string,
  phaseName: string,
): Promise<void> {
  await db
    .insert(demoLoadCheckpoints)
    .values({ tenantId, scenarioSlug, phaseName, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: demoLoadCheckpoints.tenantId,
      set: { scenarioSlug, phaseName, updatedAt: new Date() },
    });
}

async function upsertDemoStatus(
  db: Db,
  tenantId: string,
  manifest: ScenarioManifest,
  clockOffsetMs: number,
): Promise<void> {
  await db
    .insert(demoStatus)
    .values({
      tenantId,
      scenarioSlug:  manifest.slug,
      scenarioName:  manifest.name,
      schemaVersion: manifest.schemaVersion,
      referenceDate: manifest.referenceDate,
      clockOffsetMs,
      loadedAt:      new Date(),
    })
    .onConflictDoUpdate({
      target: demoStatus.tenantId,
      set: {
        scenarioSlug:  manifest.slug,
        scenarioName:  manifest.name,
        schemaVersion: manifest.schemaVersion,
        referenceDate: manifest.referenceDate,
        clockOffsetMs,
        loadedAt:      new Date(),
        nextResetAt:   null,
      },
    });
}

export async function loadScenario(
  db: Db,
  tenantId: string,
  manifest: ScenarioManifest,
  scenarioLoader: ScenarioLoader,
  opts: { dryRun?: boolean; force?: boolean },
): Promise<void> {
  const clockOffsetMs = Date.parse(manifest.referenceDate) - Date.now();

  if (opts.dryRun) {
    console.log(`[DRY RUN] Would load scenario: ${manifest.name} (${manifest.slug})`);
    console.log(`[DRY RUN] Reference date: ${manifest.referenceDate}`);
    console.log(`[DRY RUN] Clock offset: ${clockOffsetMs}ms`);
    console.log(`[DRY RUN] Phases: ${manifest.phases.join(', ')}`);
    console.log(`[DRY RUN] Target volumes:`, manifest.targetVolumes);
    await scenarioLoader(db, tenantId, 'dry-run', { dryRun: true });
    return;
  }

  // Acquire advisory lock so concurrent resets cannot overlap
  await db.execute(sql`SELECT pg_advisory_lock(hashtext('revelation-srs:demo-reset'))`);

  try {
    // When force is set, clear the checkpoint so all phases reload from scratch
    if (opts.force) {
      await db
        .delete(demoLoadCheckpoints)
        .where(
          and(
            eq(demoLoadCheckpoints.tenantId, tenantId),
            eq(demoLoadCheckpoints.scenarioSlug, manifest.slug),
          ),
        );
    }

    // Check for an existing checkpoint to resume from (rotation / interrupted load)
    const lastPhase = await getCheckpoint(db, tenantId, manifest.slug);
    const lastPhaseIdx = lastPhase !== undefined
      ? phaseIndex(manifest.phases, lastPhase as LoadPhase)
      : -1;

    for (let i = 0; i < manifest.phases.length; i++) {
      const phase = manifest.phases[i];
      if (phase === undefined) continue;

      if (i <= lastPhaseIdx) {
        console.log(`  [skip]  ${phase} (already committed)`);
        continue;
      }

      console.log(`  [load]  ${phase}`);
      await scenarioLoader(db, tenantId, phase, { dryRun: false });
      await commitCheckpoint(db, tenantId, manifest.slug, phase);
    }

    await upsertDemoStatus(db, tenantId, manifest, clockOffsetMs);
    console.log(`Scenario "${manifest.name}" loaded successfully.`);
  } finally {
    await db.execute(sql`SELECT pg_advisory_unlock(hashtext('revelation-srs:demo-reset'))`);
  }
}
