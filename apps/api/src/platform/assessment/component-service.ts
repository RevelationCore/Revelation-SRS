import { and, eq, isNull, ne } from 'drizzle-orm';
import {
  assessmentComponents,
  marks,
  moduleOfferings,
  type Db,
  withTenantContext,
} from '@revelation-srs/db';
import { NotFoundError, ValidationError } from '@revelation-srs/domain';

import type { ValueSetService } from '../value-sets/service.js';

export interface CreateAssessmentComponentInput {
  componentTypeCode: string;
  title: string;
  weighting: number;
  passMarkOverride?: number;
}

export interface UpdateAssessmentComponentInput {
  componentTypeCode?: string;
  title?: string;
  weighting?: number;
  passMarkOverride?: number | null;
}

export interface AssessmentComponentDto {
  assessmentComponentId: string;
  moduleOfferingId: string;
  componentTypeCode: string;
  title: string;
  weighting: number;
  passMarkOverride: number | null;
  createdAt: Date;
  updatedAt: Date;
}

interface ComponentValidationInput {
  componentTypeCode?: string;
  weighting?: number;
  passMarkOverride?: number | null;
}

export class AssessmentComponentService {
  constructor(
    private readonly db: Db,
    private readonly valueSets: ValueSetService,
  ) {}

  async createAssessmentComponent(
    tenantId: string,
    moduleOfferingId: string,
    input: CreateAssessmentComponentInput,
  ): Promise<string> {
    await this.#ensureModuleOfferingExists(moduleOfferingId, tenantId);
    await this.#validateComponentInput(tenantId, input);
    await this.#ensureWeightingCapacity(tenantId, moduleOfferingId, input.weighting);

    const now = new Date();
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx
        .insert(assessmentComponents)
        .values({
          tenantId: tenantId as `${string}-${string}-${string}-${string}-${string}`,
          moduleOfferingId: moduleOfferingId as `${string}-${string}-${string}-${string}-${string}`,
          componentTypeCode: input.componentTypeCode,
          title: input.title,
          weighting: input.weighting,
          passMarkOverride: input.passMarkOverride?.toFixed(2) ?? null,
          createdAt: now,
          updatedAt: now,
        })
        .returning({ id: assessmentComponents.id }),
    );

    return rows[0]!.id;
  }

  async listAssessmentComponents(
    moduleOfferingId: string,
    tenantId: string,
  ): Promise<AssessmentComponentDto[]> {
    await this.#ensureModuleOfferingExists(moduleOfferingId, tenantId);

    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx
        .select()
        .from(assessmentComponents)
        .where(
          and(
            eq(assessmentComponents.moduleOfferingId, moduleOfferingId as `${string}-${string}-${string}-${string}-${string}`),
            eq(assessmentComponents.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
          ),
        )
        .orderBy(assessmentComponents.createdAt, assessmentComponents.title),
    );

    return rows.map(componentToDto);
  }

  async updateAssessmentComponent(
    componentId: string,
    tenantId: string,
    input: UpdateAssessmentComponentInput,
    expectedModuleOfferingId?: string,
  ): Promise<void> {
    const current = await this.#getAssessmentComponent(componentId, tenantId);
    if (!current) throw new NotFoundError('AssessmentComponent', componentId);
    if (expectedModuleOfferingId && current.moduleOfferingId !== expectedModuleOfferingId) {
      throw new NotFoundError('AssessmentComponent', componentId);
    }
    await this.#ensureNoCurrentMarks(componentId, tenantId);
    await this.#validateComponentInput(tenantId, input);

    const nextWeighting = input.weighting ?? current.weighting;
    await this.#ensureWeightingCapacity(
      tenantId,
      current.moduleOfferingId,
      nextWeighting,
      componentId,
    );

    await withTenantContext(this.db, tenantId, async (tx) => {
      await tx
        .update(assessmentComponents)
        .set({
          componentTypeCode: input.componentTypeCode ?? current.componentTypeCode,
          title: input.title ?? current.title,
          weighting: nextWeighting,
          passMarkOverride: input.passMarkOverride === undefined
            ? (current.passMarkOverride?.toFixed(2) ?? null)
            : (input.passMarkOverride?.toFixed(2) ?? null),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(assessmentComponents.id, componentId as `${string}-${string}-${string}-${string}-${string}`),
            eq(assessmentComponents.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
          ),
        );
    });
  }

  async #getAssessmentComponent(
    componentId: string,
    tenantId: string,
  ): Promise<AssessmentComponentDto | null> {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx
        .select()
        .from(assessmentComponents)
        .where(
          and(
            eq(assessmentComponents.id, componentId as `${string}-${string}-${string}-${string}-${string}`),
            eq(assessmentComponents.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
          ),
        )
        .limit(1),
    );

    return rows[0] ? componentToDto(rows[0]) : null;
  }

  async #ensureModuleOfferingExists(moduleOfferingId: string, tenantId: string): Promise<void> {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx
        .select({ id: moduleOfferings.id })
        .from(moduleOfferings)
        .where(
          and(
            eq(moduleOfferings.id, moduleOfferingId as `${string}-${string}-${string}-${string}-${string}`),
            eq(moduleOfferings.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
          ),
        )
        .limit(1),
    );

    if (rows.length === 0) throw new NotFoundError('ModuleOffering', moduleOfferingId);
  }

  async #validateComponentInput(
    tenantId: string,
    input: ComponentValidationInput,
  ): Promise<void> {
    if (input.weighting !== undefined && (input.weighting < 1 || input.weighting > 100)) {
      throw new ValidationError(
        'Assessment component weighting must be between 1 and 100',
        [{ field: 'weighting', message: 'Weighting must be between 1 and 100' }],
      );
    }

    if (input.passMarkOverride !== undefined && input.passMarkOverride !== null) {
      if (input.passMarkOverride < 0 || input.passMarkOverride > 100) {
        throw new ValidationError(
          'Assessment component pass mark override must be between 0 and 100',
          [{ field: 'passMarkOverride', message: 'Pass mark override must be between 0 and 100' }],
        );
      }
    }

    if (input.componentTypeCode) {
      const isValid = await this.valueSets.validateFieldValue(
        'assessment_component',
        'component_type_code',
        input.componentTypeCode,
        tenantId,
      );
      if (isValid === false) {
        throw new ValidationError(
          `Invalid value '${input.componentTypeCode}' for assessment_component.component_type_code`,
          [{ field: 'componentTypeCode', message: 'Value is not active in the configured value set' }],
        );
      }
    }
  }

  async #ensureWeightingCapacity(
    tenantId: string,
    moduleOfferingId: string,
    candidateWeighting: number,
    excludeComponentId?: string,
  ): Promise<void> {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx
        .select({ weighting: assessmentComponents.weighting })
        .from(assessmentComponents)
        .where(
          and(
            eq(assessmentComponents.moduleOfferingId, moduleOfferingId as `${string}-${string}-${string}-${string}-${string}`),
            eq(assessmentComponents.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
            ...(excludeComponentId ? [ne(assessmentComponents.id, excludeComponentId as `${string}-${string}-${string}-${string}-${string}`)] : []),
          ),
        ),
    );

    const total = rows.reduce((sum, row) => sum + row.weighting, 0) + candidateWeighting;
    if (total > 100) {
      throw new ValidationError(
        'Assessment component weightings for a module offering cannot exceed 100',
        [{ field: 'weighting', message: `Resulting total weighting would be ${total}` }],
      );
    }
  }

  async #ensureNoCurrentMarks(componentId: string, tenantId: string): Promise<void> {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx
        .select({ id: marks.id })
        .from(marks)
        .where(
          and(
            eq(marks.assessmentComponentId, componentId as `${string}-${string}-${string}-${string}-${string}`),
            eq(marks.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
            isNull(marks.recordedUntil),
          ),
        )
        .limit(1),
    );

    if (rows.length > 0) {
      throw new ValidationError(
        'Assessment component cannot be updated after marks have been ingested',
        [{ field: 'assessmentComponentId', message: 'Current marks reference this component' }],
      );
    }
  }
}

function componentToDto(row: typeof assessmentComponents.$inferSelect): AssessmentComponentDto {
  return {
    assessmentComponentId: row.id,
    moduleOfferingId: row.moduleOfferingId,
    componentTypeCode: row.componentTypeCode,
    title: row.title,
    weighting: row.weighting,
    passMarkOverride: row.passMarkOverride === null ? null : Number(row.passMarkOverride),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
