import {
  academicPeriods,
  academicRules,
  awardingBodies,
  featureFlagAssignments,
  featureFlags,
  featureFlagVariants,
  moduleOfferings,
  modules,
  programmes,
  type Db,
} from '@revelation-srs/db';

import {
  generateAcademicRules,
  generateCurriculum,
  generateFeatureFlags,
  generateMultiYearCalendar,
} from '../generators/index.js';
import type { ScenarioManifest } from '../types.js';

export const manifest: ScenarioManifest = {
  slug:             'curriculum-baseline',
  name:             'Curriculum Baseline',
  schemaVersion:    '0023',
  referenceDate:    '2025-11-14',
  academicYears:    ['2023-24', '2024-25', '2025-26'],
  targetVolumes:    {
    programmes:      11,
    modules:         39,
    moduleOfferings: 150,
    academicRules:   22,
    featureFlags:    5,
  },
  loadTimeBudgetMs: 30_000,
  storyMarkers:     [],
  phases:           ['reference-data', 'tenant-config'],
};

export async function load(
  db: Db,
  tenantId: string,
  phase: string,
  opts: { dryRun?: boolean },
): Promise<void> {
  if (opts.dryRun) return;

  switch (phase) {
    case 'reference-data': return loadReferenceData(db, tenantId);
    case 'tenant-config':  return loadTenantConfig(db, tenantId);
    default: return;
  }
}

async function loadReferenceData(db: Db, tenantId: string): Promise<void> {
  const academicYears = manifest.academicYears;

  const periods    = generateMultiYearCalendar(tenantId, academicYears);
  const curriculum = generateCurriculum(tenantId, academicYears);

  await db
    .insert(academicPeriods)
    .values(periods)
    .onConflictDoNothing();

  await db
    .insert(awardingBodies)
    .values(curriculum.awardingBodies)
    .onConflictDoNothing();

  await db
    .insert(programmes)
    .values(curriculum.programmes)
    .onConflictDoNothing();

  await db
    .insert(modules)
    .values(curriculum.modules)
    .onConflictDoNothing();

  await db
    .insert(moduleOfferings)
    .values(curriculum.moduleOfferings)
    .onConflictDoNothing();
}

async function loadTenantConfig(db: Db, tenantId: string): Promise<void> {
  const rules   = generateAcademicRules(tenantId);
  const ffData  = generateFeatureFlags(tenantId);

  await db
    .insert(academicRules)
    .values(rules)
    .onConflictDoNothing();

  if (ffData.flags.length > 0) {
    await db
      .insert(featureFlags)
      .values(ffData.flags)
      .onConflictDoNothing();
  }

  if (ffData.variants.length > 0) {
    await db
      .insert(featureFlagVariants)
      .values(ffData.variants)
      .onConflictDoNothing();
  }

  if (ffData.assignments.length > 0) {
    await db
      .insert(featureFlagAssignments)
      .values(ffData.assignments)
      .onConflictDoNothing();
  }
}
