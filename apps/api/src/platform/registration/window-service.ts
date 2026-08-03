import { randomUUID } from 'node:crypto';

import { and, eq } from 'drizzle-orm';
import {
  academicPeriods,
  registrationWindows,
  tenants,
  type Db,
  withTenantContext,
} from '@revelation-srs/db';
import { NotFoundError, ValidationError } from '@revelation-srs/domain';

type Uuid = `${string}-${string}-${string}-${string}-${string}`;

export interface RegistrationWindowInput {
  academicPeriodId: string;
  opensAt:          Date;
  closesAt:         Date;
}

export interface RegistrationWindowDto {
  registrationWindowId: string;
  academicPeriodId:     string;
  academicYear:         string;
  periodCode:           string;
  opensAt:              Date;
  closesAt:             Date;
}

/**
 * Admin-managed module-registration open/close windows, one per academic
 * period. Only consulted by ModuleRegistrationService when the tenant opts
 * in via configuration.registrationWindowMode === 'academic-period'.
 */
export class RegistrationWindowService {
  constructor(private readonly db: Db) {}

  async createWindow(tenantId: string, input: RegistrationWindowInput): Promise<string> {
    if (input.closesAt <= input.opensAt) {
      throw new ValidationError('closesAt must be after opensAt', [
        { field: 'closesAt', message: 'Window close time must be after the open time' },
      ]);
    }

    const id = randomUUID();
    await withTenantContext(this.db, tenantId, async (tx) => {
      await tx.insert(registrationWindows).values({
        id:               id as Uuid,
        tenantId:         tenantId as Uuid,
        academicPeriodId: input.academicPeriodId as Uuid,
        opensAt:          input.opensAt,
        closesAt:         input.closesAt,
      });
    });
    return id;
  }

  async updateWindow(
    registrationWindowId: string,
    tenantId: string,
    input: { opensAt: Date; closesAt: Date },
  ): Promise<void> {
    if (input.closesAt <= input.opensAt) {
      throw new ValidationError('closesAt must be after opensAt', [
        { field: 'closesAt', message: 'Window close time must be after the open time' },
      ]);
    }

    const result = await withTenantContext(this.db, tenantId, async (tx) =>
      tx.update(registrationWindows)
        .set({ opensAt: input.opensAt, closesAt: input.closesAt })
        .where(and(
          eq(registrationWindows.id,       registrationWindowId as Uuid),
          eq(registrationWindows.tenantId, tenantId              as Uuid),
        ))
        .returning({ id: registrationWindows.id }),
    );
    if (result.length === 0) throw new NotFoundError('RegistrationWindow', registrationWindowId);
  }

  async listWindows(tenantId: string): Promise<RegistrationWindowDto[]> {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx.select({
        registrationWindowId: registrationWindows.id,
        academicPeriodId:     registrationWindows.academicPeriodId,
        academicYear:         academicPeriods.academicYear,
        periodCode:           academicPeriods.periodCode,
        opensAt:              registrationWindows.opensAt,
        closesAt:             registrationWindows.closesAt,
      })
        .from(registrationWindows)
        .innerJoin(academicPeriods, eq(registrationWindows.academicPeriodId, academicPeriods.id))
        .where(eq(registrationWindows.tenantId, tenantId as Uuid))
        .orderBy(academicPeriods.startDate),
    );
    return rows;
  }

  /** Returns null if the tenant has not opted into window enforcement. */
  async getEnforcementMode(tenantId: string): Promise<string | null> {
    const rows = await this.db
      .select({ configuration: tenants.configuration })
      .from(tenants)
      .where(eq(tenants.id, tenantId as Uuid))
      .limit(1);
    const configuration = rows[0]?.configuration;
    const mode = configuration?.['registrationWindowMode'];
    return typeof mode === 'string' ? mode : null;
  }

  /** Null means no window row exists for that period. */
  async getWindowForPeriod(tenantId: string, academicPeriodId: string): Promise<{ opensAt: Date; closesAt: Date } | null> {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx.select({ opensAt: registrationWindows.opensAt, closesAt: registrationWindows.closesAt })
        .from(registrationWindows)
        .where(and(
          eq(registrationWindows.tenantId,         tenantId         as Uuid),
          eq(registrationWindows.academicPeriodId, academicPeriodId as Uuid),
        ))
        .limit(1),
    );
    return rows[0] ?? null;
  }
}
