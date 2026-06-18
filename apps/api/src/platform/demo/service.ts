import { eq } from 'drizzle-orm';
import { demoStatus, tenants, type Db } from '@revelation-srs/db';

import { clockNow } from '../clock.js';

export interface DemoStatusResponse {
  active:        boolean;
  tenantId:      string | null;
  scenarioSlug:  string | null;
  scenarioName:  string | null;
  schemaVersion: string | null;
  referenceDate: string | null;
  demoNow:       string | null;
  loadedAt:      string | null;
  nextResetAt:   string | null;
}

export class DemoService {
  constructor(private readonly db: Db) {}

  async getStatus(): Promise<DemoStatusResponse> {
    // Find the first tenant with demo_mode = true that has a loaded scenario.
    const rows = await this.db
      .select({
        tenantId:      demoStatus.tenantId,
        scenarioSlug:  demoStatus.scenarioSlug,
        scenarioName:  demoStatus.scenarioName,
        schemaVersion: demoStatus.schemaVersion,
        referenceDate: demoStatus.referenceDate,
        clockOffsetMs: demoStatus.clockOffsetMs,
        loadedAt:      demoStatus.loadedAt,
        nextResetAt:   demoStatus.nextResetAt,
      })
      .from(demoStatus)
      .innerJoin(tenants, eq(demoStatus.tenantId, tenants.id))
      .where(eq(tenants.demoMode, true))
      .limit(1);

    const row = rows[0];
    if (!row) {
      return {
        active:        false,
        tenantId:      null,
        scenarioSlug:  null,
        scenarioName:  null,
        schemaVersion: null,
        referenceDate: null,
        demoNow:       null,
        loadedAt:      null,
        nextResetAt:   null,
      };
    }

    // clockNow uses the scenario's clock offset so the returned demoNow
    // reflects demo time rather than real wall-clock time.
    const demoNow = clockNow(row.clockOffsetMs);

    return {
      active:        true,
      tenantId:      row.tenantId,
      scenarioSlug:  row.scenarioSlug,
      scenarioName:  row.scenarioName,
      schemaVersion: row.schemaVersion,
      referenceDate: row.referenceDate,
      demoNow:       demoNow.toISOString(),
      loadedAt:      row.loadedAt.toISOString(),
      nextResetAt:   row.nextResetAt?.toISOString() ?? null,
    };
  }
}
