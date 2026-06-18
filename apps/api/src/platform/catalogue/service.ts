import { randomUUID } from 'node:crypto';

import { and, eq, isNull } from 'drizzle-orm';
import {
  learningOutcomes,
  moduleRelationships,
  modules,
  programmes,
  type Db,
  withTenantContext,
} from '@revelation-srs/db';
import {
  EVENT_TYPES,
  NotFoundError,
  ValidationError,
} from '@revelation-srs/domain';
import type {
  CatalogueLearningOutcomeUpdatedV1Payload,
  CatalogueModuleRelationshipUpdatedV1Payload,
  CatalogueModuleUpdatedV1Payload,
  CatalogueProgrammeUpdatedV1Payload,
} from '@revelation-srs/domain';

import type { IntegrationBusPublisher } from '../integration-bus/publisher.js';
import type { ValueSetService } from '../value-sets/service.js';
import { clockNow } from '../clock.js';

export interface CreateProgrammeInput {
  code: string;
  title: string;
  qualificationTypeCode?: string;
  awardingBodyId?: string;
  owningSchool?: string;
  creditFrameworkCode?: string;
  fheqLevel?: number;
  creditTotal?: number;
  durationYears?: number;
  modeOfStudyCode?: string;
  sourceSystemReference?: string;
  validFrom?: Date;
}

export interface UpdateProgrammeInput extends Partial<CreateProgrammeInput> {
  validFrom?: Date;
}

export interface ProgrammeDto {
  programmeId: string;
  code: string;
  title: string;
  qualificationTypeCode: string | null;
  awardingBodyId: string | null;
  owningSchool: string | null;
  creditFrameworkCode: string | null;
  fheqLevel: number | null;
  creditTotal: number | null;
  durationYears: number | null;
  modeOfStudyCode: string | null;
  sourceSystemReference: string | null;
  validFrom: Date;
  validTo: Date | null;
  recordedAt: Date;
  recordedUntil: Date | null;
}

export interface CreateModuleInput {
  code: string;
  title: string;
  creditValue?: number;
  fheqLevel?: number;
  sourceSystemReference?: string;
  validFrom?: Date;
}

export interface UpdateModuleInput extends Partial<CreateModuleInput> {
  validFrom?: Date;
}

export interface ModuleDto {
  moduleId: string;
  code: string;
  title: string;
  creditValue: number | null;
  fheqLevel: number | null;
  sourceSystemReference: string | null;
  validFrom: Date;
  validTo: Date | null;
  recordedAt: Date;
  recordedUntil: Date | null;
}

export interface LearningOutcomeInput {
  programmeId?: string;
  moduleId?: string;
  outcomeCode: string;
  description: string;
  validFrom?: Date;
}

export interface LearningOutcomeDto {
  learningOutcomeId: string;
  programmeId: string | null;
  moduleId: string | null;
  outcomeCode: string;
  description: string;
  validFrom: Date;
  recordedAt: Date;
}

export interface ModuleRelationshipInput {
  moduleId: string;
  relatedModuleId: string;
  relationshipTypeCode: 'prerequisite' | 'co-requisite' | 'exclusion';
  validFrom?: Date;
}

export interface ModuleRelationshipDto {
  relationshipId: string;
  moduleId: string;
  relatedModuleId: string;
  relationshipTypeCode: string;
  validFrom: Date;
  recordedAt: Date;
}

export class CatalogueService {
  constructor(
    private readonly db: Db,
    private readonly eventBus: IntegrationBusPublisher,
    private readonly valueSets: ValueSetService,
  ) {}

  async #validateFieldValue(
    tenantId: string,
    entityName: string,
    fieldName: string,
    value: string | number | null | undefined,
  ): Promise<void> {
    if (value === undefined || value === null || value === '') return;

    const valueText = String(value);
    const isValid = await this.valueSets.validateFieldValue(entityName, fieldName, valueText, tenantId);
    if (isValid === false) {
      throw new ValidationError(
        `Invalid value '${valueText}' for ${entityName}.${fieldName}`,
        [{ field: fieldName, message: `Value '${valueText}' is not active in the configured value set` }],
      );
    }
  }

  async createProgramme(tenantId: string, input: CreateProgrammeInput): Promise<string> {
    await this.#validateProgrammeInput(tenantId, input);

    const programmeId = randomUUID();
    const now = clockNow();
    const validFrom = input.validFrom ?? now;

    await withTenantContext(this.db, tenantId, async (tx) => {
      await tx.insert(programmes).values({
        versionId:             randomUUID(),
        id:                    programmeId,
        tenantId:              tenantId as `${string}-${string}-${string}-${string}-${string}`,
        code:                  input.code,
        title:                 input.title,
        qualificationTypeCode: input.qualificationTypeCode ?? null,
        awardingBodyId:        input.awardingBodyId as `${string}-${string}-${string}-${string}-${string}` | undefined ?? null,
        owningSchool:          input.owningSchool ?? null,
        creditFrameworkCode:   input.creditFrameworkCode ?? null,
        fheqLevel:             input.fheqLevel ?? null,
        creditTotal:           input.creditTotal ?? null,
        durationYears:         input.durationYears ?? null,
        modeOfStudyCode:       input.modeOfStudyCode ?? null,
        sourceSystemReference: input.sourceSystemReference ?? null,
        validFrom,
        validTo:               null,
        recordedAt:            now,
        recordedUntil:         null,
      });
    });

    if (this.eventBus.isConnected()) {
      const payload: CatalogueProgrammeUpdatedV1Payload = {
        programmeId,
        code:         input.code,
        title:        input.title,
        effectiveDate: validFrom.toISOString(),
      };
      await this.eventBus.publish(
        EVENT_TYPES.CATALOGUE_PROGRAMME_UPDATED,
        '1.0.0',
        tenantId,
        programmeId,
        'standard',
        payload,
      );
    }

    return programmeId;
  }

  async listProgrammes(tenantId: string): Promise<ProgrammeDto[]> {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx
        .select()
        .from(programmes)
        .where(
          and(
            eq(programmes.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
            isNull(programmes.recordedUntil),
          ),
        )
        .orderBy(programmes.code),
    );

    return rows.map(programmeToDto);
  }

  async getProgramme(programmeId: string, tenantId: string): Promise<ProgrammeDto | null> {
    const rows = await this.#selectCurrentProgramme(programmeId, tenantId);
    return rows[0] ? programmeToDto(rows[0]) : null;
  }

  async updateProgramme(programmeId: string, tenantId: string, input: UpdateProgrammeInput): Promise<void> {
    await this.#validateProgrammeInput(tenantId, input);

    let newCode  = '';
    let newTitle = '';
    let validFrom = clockNow();

    await withTenantContext(this.db, tenantId, async (tx) => {
      const currentRows = await tx
        .select()
        .from(programmes)
        .where(
          and(
            eq(programmes.id, programmeId as `${string}-${string}-${string}-${string}-${string}`),
            eq(programmes.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
            isNull(programmes.recordedUntil),
          ),
        )
        .limit(1);

      const current = currentRows[0];
      if (!current) throw new NotFoundError('Programme', programmeId);

      const now = clockNow();
      validFrom = input.validFrom ?? now;
      newCode   = input.code  ?? current.code;
      newTitle  = input.title ?? current.title;

      await tx
        .update(programmes)
        .set({ recordedUntil: now, validTo: validFrom })
        .where(eq(programmes.versionId, current.versionId));

      await tx.insert(programmes).values({
        versionId:             randomUUID(),
        id:                    current.id,
        tenantId:              current.tenantId,
        code:                  newCode,
        title:                 newTitle,
        qualificationTypeCode: input.qualificationTypeCode ?? current.qualificationTypeCode,
        awardingBodyId:        input.awardingBodyId as `${string}-${string}-${string}-${string}-${string}` | undefined ?? current.awardingBodyId,
        owningSchool:          input.owningSchool ?? current.owningSchool,
        creditFrameworkCode:   input.creditFrameworkCode ?? current.creditFrameworkCode,
        fheqLevel:             input.fheqLevel ?? current.fheqLevel,
        creditTotal:           input.creditTotal ?? current.creditTotal,
        durationYears:         input.durationYears ?? current.durationYears,
        modeOfStudyCode:       input.modeOfStudyCode ?? current.modeOfStudyCode,
        sourceSystemReference: input.sourceSystemReference ?? current.sourceSystemReference,
        validFrom,
        validTo:               null,
        recordedAt:            now,
        recordedUntil:         null,
      });
    });

    if (this.eventBus.isConnected()) {
      const payload: CatalogueProgrammeUpdatedV1Payload = {
        programmeId,
        code:         newCode,
        title:        newTitle,
        effectiveDate: validFrom.toISOString(),
      };
      await this.eventBus.publish(
        EVENT_TYPES.CATALOGUE_PROGRAMME_UPDATED,
        '1.0.0',
        tenantId,
        programmeId,
        'standard',
        payload,
      );
    }
  }

  async getProgrammeHistory(programmeId: string, tenantId: string): Promise<ProgrammeDto[]> {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx
        .select()
        .from(programmes)
        .where(
          and(
            eq(programmes.id, programmeId as `${string}-${string}-${string}-${string}-${string}`),
            eq(programmes.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
          ),
        )
        .orderBy(programmes.recordedAt),
    );

    return rows.map(programmeToDto);
  }

  async createModule(tenantId: string, input: CreateModuleInput): Promise<string> {
    await this.#validateFieldValue(tenantId, 'module', 'fheq_level', input.fheqLevel);

    const moduleId = randomUUID();
    const now = clockNow();
    const validFrom = input.validFrom ?? now;

    await withTenantContext(this.db, tenantId, async (tx) => {
      await tx.insert(modules).values({
        versionId:             randomUUID(),
        id:                    moduleId,
        tenantId:              tenantId as `${string}-${string}-${string}-${string}-${string}`,
        code:                  input.code,
        title:                 input.title,
        creditValue:           input.creditValue ?? null,
        fheqLevel:             input.fheqLevel ?? null,
        sourceSystemReference: input.sourceSystemReference ?? null,
        validFrom,
        validTo:               null,
        recordedAt:            now,
        recordedUntil:         null,
      });
    });

    if (this.eventBus.isConnected()) {
      const payload: CatalogueModuleUpdatedV1Payload = {
        moduleId,
        code:         input.code,
        title:        input.title,
        creditValue:  input.creditValue ?? null,
        effectiveDate: validFrom.toISOString(),
      };
      await this.eventBus.publish(
        EVENT_TYPES.CATALOGUE_MODULE_UPDATED,
        '1.0.0',
        tenantId,
        moduleId,
        'standard',
        payload,
      );
    }

    return moduleId;
  }

  async listModules(tenantId: string): Promise<ModuleDto[]> {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx
        .select()
        .from(modules)
        .where(
          and(
            eq(modules.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
            isNull(modules.recordedUntil),
          ),
        )
        .orderBy(modules.code),
    );

    return rows.map(moduleToDto);
  }

  async getModule(moduleId: string, tenantId: string): Promise<ModuleDto | null> {
    const rows = await this.#selectCurrentModule(moduleId, tenantId);
    return rows[0] ? moduleToDto(rows[0]) : null;
  }

  async updateModule(moduleId: string, tenantId: string, input: UpdateModuleInput): Promise<void> {
    await this.#validateFieldValue(tenantId, 'module', 'fheq_level', input.fheqLevel);

    let newCode        = '';
    let newTitle       = '';
    let newCreditValue: number | null = null;
    let validFrom      = clockNow();

    await withTenantContext(this.db, tenantId, async (tx) => {
      const currentRows = await tx
        .select()
        .from(modules)
        .where(
          and(
            eq(modules.id, moduleId as `${string}-${string}-${string}-${string}-${string}`),
            eq(modules.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
            isNull(modules.recordedUntil),
          ),
        )
        .limit(1);

      const current = currentRows[0];
      if (!current) throw new NotFoundError('Module', moduleId);

      const now = clockNow();
      validFrom      = input.validFrom   ?? now;
      newCode        = input.code        ?? current.code;
      newTitle       = input.title       ?? current.title;
      newCreditValue = input.creditValue ?? current.creditValue;

      await tx
        .update(modules)
        .set({ recordedUntil: now, validTo: validFrom })
        .where(eq(modules.versionId, current.versionId));

      await tx.insert(modules).values({
        versionId:             randomUUID(),
        id:                    current.id,
        tenantId:              current.tenantId,
        code:                  newCode,
        title:                 newTitle,
        creditValue:           newCreditValue,
        fheqLevel:             input.fheqLevel ?? current.fheqLevel,
        sourceSystemReference: input.sourceSystemReference ?? current.sourceSystemReference,
        validFrom,
        validTo:               null,
        recordedAt:            now,
        recordedUntil:         null,
      });
    });

    if (this.eventBus.isConnected()) {
      const payload: CatalogueModuleUpdatedV1Payload = {
        moduleId,
        code:         newCode,
        title:        newTitle,
        creditValue:  newCreditValue,
        effectiveDate: validFrom.toISOString(),
      };
      await this.eventBus.publish(
        EVENT_TYPES.CATALOGUE_MODULE_UPDATED,
        '1.0.0',
        tenantId,
        moduleId,
        'standard',
        payload,
      );
    }
  }

  async getModuleHistory(moduleId: string, tenantId: string): Promise<ModuleDto[]> {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx
        .select()
        .from(modules)
        .where(
          and(
            eq(modules.id, moduleId as `${string}-${string}-${string}-${string}-${string}`),
            eq(modules.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
          ),
        )
        .orderBy(modules.recordedAt),
    );

    return rows.map(moduleToDto);
  }

  async createLearningOutcome(tenantId: string, input: LearningOutcomeInput): Promise<string> {
    if ((input.programmeId ? 1 : 0) + (input.moduleId ? 1 : 0) !== 1) {
      throw new ValidationError('Learning outcome must belong to exactly one programme or module');
    }
    if (input.programmeId) await this.#ensureProgrammeExists(input.programmeId, tenantId);
    if (input.moduleId) await this.#ensureModuleExists(input.moduleId, tenantId);

    const learningOutcomeId = randomUUID();
    const now = clockNow();
    const validFrom = input.validFrom ?? now;

    await withTenantContext(this.db, tenantId, async (tx) => {
      await tx.insert(learningOutcomes).values({
        versionId:   randomUUID(),
        id:          learningOutcomeId,
        tenantId:    tenantId as `${string}-${string}-${string}-${string}-${string}`,
        programmeId: input.programmeId as `${string}-${string}-${string}-${string}-${string}` | undefined ?? null,
        moduleId:    input.moduleId as `${string}-${string}-${string}-${string}-${string}` | undefined ?? null,
        outcomeCode: input.outcomeCode,
        description: input.description,
        validFrom,
        validTo:     null,
        recordedAt:  now,
        recordedUntil: null,
      });
    });

    if (this.eventBus.isConnected()) {
      const payload: CatalogueLearningOutcomeUpdatedV1Payload = {
        learningOutcomeId,
        programmeId:  input.programmeId ?? null,
        moduleId:     input.moduleId    ?? null,
        outcomeCode:  input.outcomeCode,
        effectiveDate: validFrom.toISOString(),
      };
      await this.eventBus.publish(
        EVENT_TYPES.CATALOGUE_LEARNING_OUTCOME_UPDATED,
        '1.0.0',
        tenantId,
        learningOutcomeId,
        'standard',
        payload,
      );
    }

    return learningOutcomeId;
  }

  async listLearningOutcomes(
    tenantId: string,
    opts: { programmeId?: string; moduleId?: string },
  ): Promise<LearningOutcomeDto[]> {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx
        .select()
        .from(learningOutcomes)
        .where(
          and(
            eq(learningOutcomes.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
            isNull(learningOutcomes.recordedUntil),
            ...(opts.programmeId ? [eq(learningOutcomes.programmeId, opts.programmeId as `${string}-${string}-${string}-${string}-${string}`)] : []),
            ...(opts.moduleId ? [eq(learningOutcomes.moduleId, opts.moduleId as `${string}-${string}-${string}-${string}-${string}`)] : []),
          ),
        )
        .orderBy(learningOutcomes.outcomeCode),
    );

    return rows.map((row) => ({
      learningOutcomeId: row.id,
      programmeId:       row.programmeId,
      moduleId:          row.moduleId,
      outcomeCode:       row.outcomeCode,
      description:       row.description,
      validFrom:         row.validFrom,
      recordedAt:        row.recordedAt,
    }));
  }

  async createModuleRelationship(tenantId: string, input: ModuleRelationshipInput): Promise<string> {
    await this.#ensureModuleExists(input.moduleId, tenantId);
    await this.#ensureModuleExists(input.relatedModuleId, tenantId);

    const relationshipId = randomUUID();
    const now = clockNow();
    const validFrom = input.validFrom ?? now;

    await withTenantContext(this.db, tenantId, async (tx) => {
      await tx.insert(moduleRelationships).values({
        versionId:            randomUUID(),
        id:                   relationshipId,
        tenantId:             tenantId as `${string}-${string}-${string}-${string}-${string}`,
        moduleId:             input.moduleId as `${string}-${string}-${string}-${string}-${string}`,
        relatedModuleId:      input.relatedModuleId as `${string}-${string}-${string}-${string}-${string}`,
        relationshipTypeCode: input.relationshipTypeCode,
        validFrom,
        validTo:              null,
        recordedAt:           now,
        recordedUntil:        null,
      });
    });

    if (this.eventBus.isConnected()) {
      const payload: CatalogueModuleRelationshipUpdatedV1Payload = {
        relationshipId,
        moduleId:             input.moduleId,
        relatedModuleId:      input.relatedModuleId,
        relationshipTypeCode: input.relationshipTypeCode,
        effectiveDate:        validFrom.toISOString(),
      };
      await this.eventBus.publish(
        EVENT_TYPES.CATALOGUE_MODULE_RELATIONSHIP_UPDATED,
        '1.0.0',
        tenantId,
        relationshipId,
        'standard',
        payload,
      );
    }

    return relationshipId;
  }

  async listModuleRelationships(moduleId: string, tenantId: string): Promise<ModuleRelationshipDto[]> {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx
        .select()
        .from(moduleRelationships)
        .where(
          and(
            eq(moduleRelationships.moduleId, moduleId as `${string}-${string}-${string}-${string}-${string}`),
            eq(moduleRelationships.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
            isNull(moduleRelationships.recordedUntil),
          ),
        )
        .orderBy(moduleRelationships.relationshipTypeCode),
    );

    return rows.map((row) => ({
      relationshipId:       row.id,
      moduleId:             row.moduleId,
      relatedModuleId:      row.relatedModuleId,
      relationshipTypeCode: row.relationshipTypeCode,
      validFrom:            row.validFrom,
      recordedAt:           row.recordedAt,
    }));
  }

  async #validateProgrammeInput(tenantId: string, input: Partial<CreateProgrammeInput>): Promise<void> {
    await this.#validateFieldValue(tenantId, 'programme', 'qualification_type_code', input.qualificationTypeCode);
    await this.#validateFieldValue(tenantId, 'programme', 'mode_of_study_code', input.modeOfStudyCode);
    await this.#validateFieldValue(tenantId, 'programme', 'fheq_level', input.fheqLevel);
  }

  async #selectCurrentProgramme(programmeId: string, tenantId: string) {
    return withTenantContext(this.db, tenantId, async (tx) =>
      tx
        .select()
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
  }

  async #selectCurrentModule(moduleId: string, tenantId: string) {
    return withTenantContext(this.db, tenantId, async (tx) =>
      tx
        .select()
        .from(modules)
        .where(
          and(
            eq(modules.id, moduleId as `${string}-${string}-${string}-${string}-${string}`),
            eq(modules.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
            isNull(modules.recordedUntil),
          ),
        )
        .limit(1),
    );
  }

  async #ensureProgrammeExists(programmeId: string, tenantId: string): Promise<void> {
    const rows = await this.#selectCurrentProgramme(programmeId, tenantId);
    if (rows.length === 0) throw new NotFoundError('Programme', programmeId);
  }

  async #ensureModuleExists(moduleId: string, tenantId: string): Promise<void> {
    const rows = await this.#selectCurrentModule(moduleId, tenantId);
    if (rows.length === 0) throw new NotFoundError('Module', moduleId);
  }
}

function programmeToDto(row: typeof programmes.$inferSelect): ProgrammeDto {
  return {
    programmeId:           row.id,
    code:                  row.code,
    title:                 row.title,
    qualificationTypeCode: row.qualificationTypeCode,
    awardingBodyId:        row.awardingBodyId,
    owningSchool:          row.owningSchool,
    creditFrameworkCode:   row.creditFrameworkCode,
    fheqLevel:             row.fheqLevel,
    creditTotal:           row.creditTotal,
    durationYears:         row.durationYears,
    modeOfStudyCode:       row.modeOfStudyCode,
    sourceSystemReference: row.sourceSystemReference,
    validFrom:             row.validFrom,
    validTo:               row.validTo,
    recordedAt:            row.recordedAt,
    recordedUntil:         row.recordedUntil,
  };
}

function moduleToDto(row: typeof modules.$inferSelect): ModuleDto {
  return {
    moduleId:              row.id,
    code:                  row.code,
    title:                 row.title,
    creditValue:           row.creditValue,
    fheqLevel:             row.fheqLevel,
    sourceSystemReference: row.sourceSystemReference,
    validFrom:             row.validFrom,
    validTo:               row.validTo,
    recordedAt:            row.recordedAt,
    recordedUntil:         row.recordedUntil,
  };
}
