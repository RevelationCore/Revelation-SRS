import { and, eq } from 'drizzle-orm';
import {
  academicPeriods,
  moduleOfferings,
  modules,
  type Db,
  withTenantContext,
} from '@revelation-srs/db';
import { NotFoundError } from '@revelation-srs/domain';

export interface AcademicPeriodInput {
  academicYear: string;
  periodCode: string;
  periodTypeCode: 'semester' | 'term' | 'year';
  startDate: string;
  endDate: string;
}

export interface AcademicPeriodDto {
  academicPeriodId: string;
  academicYear: string;
  periodCode: string;
  periodTypeCode: string;
  startDate: string;
  endDate: string;
}

export interface ModuleOfferingInput {
  moduleId: string;
  academicPeriodId: string;
  deliveryModeCode?: string;
  capacity?: number;
}

export interface ModuleOfferingDto {
  moduleOfferingId: string;
  moduleId: string;
  academicPeriodId: string;
  deliveryModeCode: string | null;
  capacity: number | null;
}

export class CalendarService {
  constructor(private readonly db: Db) {}

  async createAcademicPeriod(tenantId: string, input: AcademicPeriodInput): Promise<string> {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx
        .insert(academicPeriods)
        .values({
          tenantId:       tenantId as `${string}-${string}-${string}-${string}-${string}`,
          academicYear:   input.academicYear,
          periodCode:     input.periodCode,
          periodTypeCode: input.periodTypeCode,
          startDate:      input.startDate,
          endDate:        input.endDate,
        })
        .returning({ id: academicPeriods.id }),
    );

    return rows[0]!.id;
  }

  async listAcademicPeriods(
    tenantId: string,
    opts: { academicYear?: string } = {},
  ): Promise<AcademicPeriodDto[]> {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx
        .select()
        .from(academicPeriods)
        .where(
          and(
            eq(academicPeriods.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
            ...(opts.academicYear ? [eq(academicPeriods.academicYear, opts.academicYear)] : []),
          ),
        )
        .orderBy(academicPeriods.academicYear, academicPeriods.startDate),
    );

    return rows.map(academicPeriodToDto);
  }

  async getAcademicPeriod(academicPeriodId: string, tenantId: string): Promise<AcademicPeriodDto | null> {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx
        .select()
        .from(academicPeriods)
        .where(
          and(
            eq(academicPeriods.id, academicPeriodId as `${string}-${string}-${string}-${string}-${string}`),
            eq(academicPeriods.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
          ),
        )
        .limit(1),
    );

    return rows[0] ? academicPeriodToDto(rows[0]) : null;
  }

  async createModuleOffering(tenantId: string, input: ModuleOfferingInput): Promise<string> {
    await this.#ensureModuleExists(input.moduleId, tenantId);
    await this.#ensureAcademicPeriodExists(input.academicPeriodId, tenantId);

    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx
        .insert(moduleOfferings)
        .values({
          tenantId:         tenantId as `${string}-${string}-${string}-${string}-${string}`,
          moduleId:         input.moduleId as `${string}-${string}-${string}-${string}-${string}`,
          academicPeriodId: input.academicPeriodId as `${string}-${string}-${string}-${string}-${string}`,
          deliveryModeCode: input.deliveryModeCode ?? null,
          capacity:         input.capacity ?? null,
        })
        .returning({ id: moduleOfferings.id }),
    );

    return rows[0]!.id;
  }

  async listModuleOfferings(
    tenantId: string,
    opts: { academicPeriodId?: string; moduleId?: string } = {},
  ): Promise<ModuleOfferingDto[]> {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx
        .select()
        .from(moduleOfferings)
        .where(
          and(
            eq(moduleOfferings.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
            ...(opts.academicPeriodId ? [eq(moduleOfferings.academicPeriodId, opts.academicPeriodId as `${string}-${string}-${string}-${string}-${string}`)] : []),
            ...(opts.moduleId ? [eq(moduleOfferings.moduleId, opts.moduleId as `${string}-${string}-${string}-${string}-${string}`)] : []),
          ),
        )
        .orderBy(moduleOfferings.academicPeriodId, moduleOfferings.moduleId),
    );

    return rows.map(moduleOfferingToDto);
  }

  async getModuleOffering(moduleOfferingId: string, tenantId: string): Promise<ModuleOfferingDto | null> {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx
        .select()
        .from(moduleOfferings)
        .where(
          and(
            eq(moduleOfferings.id, moduleOfferingId as `${string}-${string}-${string}-${string}-${string}`),
            eq(moduleOfferings.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
          ),
        )
        .limit(1),
    );

    return rows[0] ? moduleOfferingToDto(rows[0]) : null;
  }

  async #ensureAcademicPeriodExists(academicPeriodId: string, tenantId: string): Promise<void> {
    const period = await this.getAcademicPeriod(academicPeriodId, tenantId);
    if (!period) throw new NotFoundError('AcademicPeriod', academicPeriodId);
  }

  async #ensureModuleExists(moduleId: string, tenantId: string): Promise<void> {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx
        .select({ id: modules.id })
        .from(modules)
        .where(
          and(
            eq(modules.id, moduleId as `${string}-${string}-${string}-${string}-${string}`),
            eq(modules.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
          ),
        )
        .limit(1),
    );
    if (rows.length === 0) throw new NotFoundError('Module', moduleId);
  }
}

function academicPeriodToDto(row: typeof academicPeriods.$inferSelect): AcademicPeriodDto {
  return {
    academicPeriodId: row.id,
    academicYear:     row.academicYear,
    periodCode:       row.periodCode,
    periodTypeCode:   row.periodTypeCode,
    startDate:        row.startDate,
    endDate:          row.endDate,
  };
}

function moduleOfferingToDto(row: typeof moduleOfferings.$inferSelect): ModuleOfferingDto {
  return {
    moduleOfferingId: row.id,
    moduleId:         row.moduleId,
    academicPeriodId: row.academicPeriodId,
    deliveryModeCode: row.deliveryModeCode,
    capacity:         row.capacity,
  };
}
