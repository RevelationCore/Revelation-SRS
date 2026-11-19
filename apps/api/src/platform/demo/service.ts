import { eq } from 'drizzle-orm';
import { demoStatus, tenants, withTenantContext, type Db } from '@revelation-srs/db';

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

type DemoStatusRow = {
  tenantId: string; scenarioSlug: string; scenarioName: string; schemaVersion: string;
  referenceDate: string; clockOffsetMs: number; loadedAt: Date; nextResetAt: Date | null;
};

export class DemoService {
  constructor(private readonly db: Db) {}

  async getStatus(): Promise<DemoStatusResponse> {
    // Find the first tenant with demo_mode = true that has a loaded scenario.
    // demo_status is tenant-isolated, so each demo tenant is read in its own
    // context (the tenant table itself is not tenant data).
    const demoTenants = await this.db.select({ id: tenants.id }).from(tenants)
      .where(eq(tenants.demoMode, true)).orderBy(tenants.code);
    let row: DemoStatusRow | undefined;
    for (const { id } of demoTenants) {
      row = await this.#statusFor(id);
      if (row) break;
    }

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

  async #statusFor(tenantId: string): Promise<DemoStatusRow | undefined> {
    const rows = await withTenantContext(this.db, tenantId, (tx) => tx
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
      .where(eq(demoStatus.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`))
      .limit(1));
    return rows[0];
  }
}
