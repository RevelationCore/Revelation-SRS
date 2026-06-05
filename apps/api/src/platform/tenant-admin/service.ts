import { randomUUID } from 'node:crypto';

import { and, eq, isNull } from 'drizzle-orm';
import {
  academicRules,
  programmes,
  tenants,
  type Db,
  withTenantContext,
} from '@revelation-srs/db';
import { ConflictError, NotFoundError } from '@revelation-srs/domain';

export interface CreateTenantInput {
  code: string;
  name: string;
  configuration?: Record<string, unknown>;
  active?: boolean;
}

export interface UpdateTenantInput {
  name?: string;
  configuration?: Record<string, unknown>;
  active?: boolean;
}

export interface TenantDto {
  tenantId: string;
  code: string;
  name: string;
  configuration: Record<string, unknown>;
  active: boolean;
  createdAt: Date;
}

export interface CreateAcademicRuleInput {
  programmeId?: string;
  ruleTypeCode: string;
  ruleKey: string;
  ruleValue: Record<string, unknown>;
  description?: string;
  appliesToLevel?: number;
  validFrom?: Date;
}

export interface UpdateAcademicRuleInput extends Partial<CreateAcademicRuleInput> {
  validFrom?: Date;
}

export interface AcademicRuleDto {
  academicRuleId: string;
  programmeId: string | null;
  ruleTypeCode: string;
  ruleKey: string;
  ruleValue: Record<string, unknown>;
  description: string | null;
  appliesToLevel: number | null;
  validFrom: Date;
  validTo: Date | null;
  recordedAt: Date;
  recordedUntil: Date | null;
}

export class TenantAdminService {
  constructor(private readonly db: Db) {}

  async createTenant(input: CreateTenantInput): Promise<string> {
    const existing = await this.db
      .select({ id: tenants.id })
      .from(tenants)
      .where(eq(tenants.code, input.code))
      .limit(1);

    if (existing.length > 0) {
      throw new ConflictError(`Tenant code '${input.code}' already exists`);
    }

    const rows = await this.db
      .insert(tenants)
      .values({
        code: input.code,
        name: input.name,
        configuration: input.configuration ?? {},
        active: input.active ?? true,
      })
      .returning({ id: tenants.id });

    return rows[0]!.id;
  }

  async listTenants(): Promise<TenantDto[]> {
    const rows = await this.db.select().from(tenants).orderBy(tenants.code);
    return rows.map(tenantToDto);
  }

  async getTenant(tenantId: string): Promise<TenantDto | null> {
    const rows = await this.db
      .select()
      .from(tenants)
      .where(eq(tenants.id, tenantId as `${string}-${string}-${string}-${string}-${string}`))
      .limit(1);

    return rows[0] ? tenantToDto(rows[0]) : null;
  }

  async updateTenant(tenantId: string, input: UpdateTenantInput): Promise<void> {
    const current = await this.getTenant(tenantId);
    if (!current) throw new NotFoundError('Tenant', tenantId);

    await this.db
      .update(tenants)
      .set({
        name: input.name ?? current.name,
        configuration: input.configuration ?? current.configuration,
        active: input.active ?? current.active,
      })
      .where(eq(tenants.id, tenantId as `${string}-${string}-${string}-${string}-${string}`));
  }

  async mergeTenantConfiguration(
    tenantId: string,
    patch: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const current = await this.getTenant(tenantId);
    if (!current) throw new NotFoundError('Tenant', tenantId);

    const configuration = { ...current.configuration, ...patch };
    await this.updateTenant(tenantId, { configuration });
    return configuration;
  }

  async createAcademicRule(tenantId: string, input: CreateAcademicRuleInput): Promise<string> {
    if (input.programmeId) await this.#ensureProgrammeExists(input.programmeId, tenantId);

    const academicRuleId = randomUUID();
    const now = new Date();
    await withTenantContext(this.db, tenantId, async (tx) => {
      await tx.insert(academicRules).values({
        versionId: randomUUID(),
        id: academicRuleId,
        tenantId: tenantId as `${string}-${string}-${string}-${string}-${string}`,
        programmeId: input.programmeId as `${string}-${string}-${string}-${string}-${string}` | undefined ?? null,
        ruleTypeCode: input.ruleTypeCode,
        ruleKey: input.ruleKey,
        ruleValue: input.ruleValue,
        description: input.description ?? null,
        appliesToLevel: input.appliesToLevel ?? null,
        validFrom: input.validFrom ?? now,
        validTo: null,
        recordedAt: now,
        recordedUntil: null,
      });
    });

    return academicRuleId;
  }

  async listAcademicRules(
    tenantId: string,
    opts: { ruleTypeCode?: string; ruleKey?: string; programmeId?: string } = {},
  ): Promise<AcademicRuleDto[]> {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx
        .select()
        .from(academicRules)
        .where(
          and(
            eq(academicRules.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
            isNull(academicRules.recordedUntil),
            ...(opts.ruleTypeCode ? [eq(academicRules.ruleTypeCode, opts.ruleTypeCode)] : []),
            ...(opts.ruleKey ? [eq(academicRules.ruleKey, opts.ruleKey)] : []),
            ...(opts.programmeId ? [eq(academicRules.programmeId, opts.programmeId as `${string}-${string}-${string}-${string}-${string}`)] : []),
          ),
        )
        .orderBy(academicRules.ruleTypeCode, academicRules.ruleKey),
    );

    return rows.map(academicRuleToDto);
  }

  async getAcademicRule(academicRuleId: string, tenantId: string): Promise<AcademicRuleDto | null> {
    const rows = await this.#selectAcademicRule(academicRuleId, tenantId, true);
    return rows[0] ? academicRuleToDto(rows[0]) : null;
  }

  async updateAcademicRule(
    academicRuleId: string,
    tenantId: string,
    input: UpdateAcademicRuleInput,
  ): Promise<void> {
    if (input.programmeId) await this.#ensureProgrammeExists(input.programmeId, tenantId);

    await withTenantContext(this.db, tenantId, async (tx) => {
      const currentRows = await tx
        .select()
        .from(academicRules)
        .where(
          and(
            eq(academicRules.id, academicRuleId as `${string}-${string}-${string}-${string}-${string}`),
            eq(academicRules.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
            isNull(academicRules.recordedUntil),
          ),
        )
        .limit(1);

      const current = currentRows[0];
      if (!current) throw new NotFoundError('AcademicRule', academicRuleId);

      const now = new Date();
      const validFrom = input.validFrom ?? now;
      await tx
        .update(academicRules)
        .set({ recordedUntil: now, validTo: validFrom })
        .where(eq(academicRules.versionId, current.versionId));

      await tx.insert(academicRules).values({
        versionId: randomUUID(),
        id: current.id,
        tenantId: current.tenantId,
        programmeId: input.programmeId as `${string}-${string}-${string}-${string}-${string}` | undefined ?? current.programmeId,
        ruleTypeCode: input.ruleTypeCode ?? current.ruleTypeCode,
        ruleKey: input.ruleKey ?? current.ruleKey,
        ruleValue: input.ruleValue ?? current.ruleValue,
        description: input.description ?? current.description,
        appliesToLevel: input.appliesToLevel ?? current.appliesToLevel,
        validFrom,
        validTo: null,
        recordedAt: now,
        recordedUntil: null,
      });
    });
  }

  async getAcademicRuleHistory(academicRuleId: string, tenantId: string): Promise<AcademicRuleDto[]> {
    const rows = await this.#selectAcademicRule(academicRuleId, tenantId, false);
    return rows.map(academicRuleToDto);
  }

  async #selectAcademicRule(academicRuleId: string, tenantId: string, currentOnly: boolean) {
    return withTenantContext(this.db, tenantId, async (tx) =>
      tx
        .select()
        .from(academicRules)
        .where(
          and(
            eq(academicRules.id, academicRuleId as `${string}-${string}-${string}-${string}-${string}`),
            eq(academicRules.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
            ...(currentOnly ? [isNull(academicRules.recordedUntil)] : []),
          ),
        )
        .orderBy(academicRules.recordedAt),
    );
  }

  async #ensureProgrammeExists(programmeId: string, tenantId: string): Promise<void> {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx
        .select({ id: programmes.id })
        .from(programmes)
        .where(
          and(
            eq(programmes.id, programmeId as `${string}-${string}-${string}-${string}-${string}`),
            eq(programmes.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
            isNull(programmes.recordedUntil),
          ),
        )
        .limit(1),
    );

    if (rows.length === 0) throw new NotFoundError('Programme', programmeId);
  }
}

function tenantToDto(row: typeof tenants.$inferSelect): TenantDto {
  return {
    tenantId: row.id,
    code: row.code,
    name: row.name,
    configuration: row.configuration,
    active: row.active,
    createdAt: row.createdAt,
  };
}

function academicRuleToDto(row: typeof academicRules.$inferSelect): AcademicRuleDto {
  return {
    academicRuleId: row.id,
    programmeId: row.programmeId,
    ruleTypeCode: row.ruleTypeCode,
    ruleKey: row.ruleKey,
    ruleValue: row.ruleValue,
    description: row.description,
    appliesToLevel: row.appliesToLevel,
    validFrom: row.validFrom,
    validTo: row.validTo,
    recordedAt: row.recordedAt,
    recordedUntil: row.recordedUntil,
  };
}
