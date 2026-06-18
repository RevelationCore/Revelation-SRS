import { randomUUID } from 'node:crypto';

import { and, eq, inArray, isNull } from 'drizzle-orm';
import {
  academicPeriods,
  enrolments,
  moduleOfferings,
  moduleRegistrations,
  moduleRelationships,
  modules,
  type Db,
  withTenantContext,
} from '@revelation-srs/db';
import {
  ConflictError,
  EVENT_TYPES,
  NotFoundError,
  ValidationError,
} from '@revelation-srs/domain';
import type {
  EnrolmentModuleRegisteredV1Payload,
  EnrolmentModuleRegistrationCompletedV1Payload,
  EnrolmentModuleRegistrationWithdrawnV1Payload,
} from '@revelation-srs/domain';

import type { IntegrationBusPublisher } from '../integration-bus/publisher.js';
import type { RulesEngine } from '../rules-engine/engine.js';
import { clockNow } from '../clock.js';

export interface CreateModuleRegistrationInput {
  enrolmentId: string;
  moduleOfferingId: string;
  registrationDate?: string;
  validFrom?: Date;
}

export interface ModuleRegistrationDto {
  moduleRegistrationId: string;
  enrolmentId: string;
  moduleOfferingId: string;
  moduleId: string;
  academicPeriodId: string;
  statusCode: string;
  registrationDate: string;
  validFrom: Date;
  validTo: Date | null;
  recordedAt: Date;
  recordedUntil: Date | null;
}

export interface TimetableRegistrationDto {
  moduleRegistrationId: string;
  enrolmentId: string;
  moduleOfferingId: string;
  moduleId: string;
  moduleCode: string;
  moduleTitle: string;
  academicPeriodId: string;
  academicYear: string;
  periodCode: string;
  periodTypeCode: string;
  startDate: string;
  endDate: string;
  deliveryModeCode: string | null;
}

type RegistrationStatusCode = 'registered' | 'withdrawn' | 'completed';

interface CurrentEnrolment {
  enrolmentId: string;
  statusCode: string;
  programmeId: string | null;
}

interface OfferingContext {
  moduleOfferingId: string;
  moduleId: string;
  academicPeriodId: string;
  capacity: number | null;
  creditValue: number | null;
  periodStartDate: string;
  periodEndDate: string;
}

export class ModuleRegistrationService {
  constructor(
    private readonly db: Db,
    private readonly eventBus: IntegrationBusPublisher,
    private readonly rules: RulesEngine,
  ) {}

  async createRegistration(
    tenantId: string,
    input: CreateModuleRegistrationInput,
    actorId: string,
  ): Promise<string> {
    const registrationDate = input.registrationDate ?? clockNow().toISOString().slice(0, 10);
    const enrolment = await this.#getCurrentEnrolment(input.enrolmentId, tenantId);
    const offering = await this.#getOfferingContext(input.moduleOfferingId, tenantId);

    if (enrolment.statusCode !== 'enrolled') {
      throw new ValidationError(
        `Cannot register modules for enrolment in status '${enrolment.statusCode}'`,
        [{ field: 'enrolmentId', message: 'Enrolment must be enrolled' }],
      );
    }

    this.#validateRegistrationWindow(registrationDate, offering);
    await this.#ensureNoDuplicateCurrentRegistration(input.enrolmentId, input.moduleOfferingId, tenantId);
    await this.#ensureCapacityAvailable(input.moduleOfferingId, offering.capacity, tenantId);
    await this.#ensureModuleRulesSatisfied(input.enrolmentId, offering, tenantId);
    await this.#ensureCreditLimitNotExceeded(enrolment, offering, tenantId);

    const moduleRegistrationId = randomUUID();
    const now = clockNow();
    await withTenantContext(this.db, tenantId, async (tx) => {
      await tx.insert(moduleRegistrations).values({
        versionId:        randomUUID(),
        id:               moduleRegistrationId,
        tenantId:         tenantId as `${string}-${string}-${string}-${string}-${string}`,
        enrolmentId:      input.enrolmentId as `${string}-${string}-${string}-${string}-${string}`,
        moduleOfferingId: input.moduleOfferingId as `${string}-${string}-${string}-${string}-${string}`,
        statusCode:       'registered',
        registrationDate,
        validFrom:        input.validFrom ?? now,
        validTo:          null,
        recordedAt:       now,
        recordedUntil:    null,
      });
    });

    if (this.eventBus.isConnected()) {
      const payload: EnrolmentModuleRegisteredV1Payload = {
        enrolmentId: input.enrolmentId,
        moduleRegistrationId,
        moduleOfferingId: input.moduleOfferingId,
        moduleId: offering.moduleId,
        academicPeriodId: offering.academicPeriodId,
        registrationDate,
      };
      await this.eventBus.publish(
        EVENT_TYPES.ENROLMENT_MODULE_REGISTERED,
        '1.0.0',
        tenantId,
        actorId,
        'personal',
        payload,
      );
    }

    return moduleRegistrationId;
  }

  async listRegistrations(
    tenantId: string,
    opts: { enrolmentId?: string; moduleOfferingId?: string; statusCode?: string } = {},
  ): Promise<ModuleRegistrationDto[]> {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx
        .select({
          registration: moduleRegistrations,
          moduleId: moduleOfferings.moduleId,
          academicPeriodId: moduleOfferings.academicPeriodId,
        })
        .from(moduleRegistrations)
        .innerJoin(moduleOfferings, eq(moduleRegistrations.moduleOfferingId, moduleOfferings.id))
        .where(
          and(
            eq(moduleRegistrations.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
            eq(moduleOfferings.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
            isNull(moduleRegistrations.recordedUntil),
            ...(opts.enrolmentId ? [eq(moduleRegistrations.enrolmentId, opts.enrolmentId as `${string}-${string}-${string}-${string}-${string}`)] : []),
            ...(opts.moduleOfferingId ? [eq(moduleRegistrations.moduleOfferingId, opts.moduleOfferingId as `${string}-${string}-${string}-${string}-${string}`)] : []),
            ...(opts.statusCode ? [eq(moduleRegistrations.statusCode, opts.statusCode)] : []),
          ),
        )
        .orderBy(moduleRegistrations.registrationDate),
    );

    return rows.map((row) => registrationToDto(row.registration, row.moduleId, row.academicPeriodId));
  }

  async getRegistration(moduleRegistrationId: string, tenantId: string): Promise<ModuleRegistrationDto | null> {
    const rows = await this.#selectRegistration(moduleRegistrationId, tenantId, true);
    const row = rows[0];
    return row ? registrationToDto(row.registration, row.moduleId, row.academicPeriodId) : null;
  }

  async getRegistrationHistory(moduleRegistrationId: string, tenantId: string): Promise<ModuleRegistrationDto[]> {
    const rows = await this.#selectRegistration(moduleRegistrationId, tenantId, false);
    return rows.map((row) => registrationToDto(row.registration, row.moduleId, row.academicPeriodId));
  }

  async withdrawRegistration(
    moduleRegistrationId: string,
    tenantId: string,
    actorId: string,
    validFrom: Date = clockNow(),
  ): Promise<void> {
    await this.#transitionRegistration(moduleRegistrationId, tenantId, 'withdrawn', actorId, validFrom);
  }

  async completeRegistration(
    moduleRegistrationId: string,
    tenantId: string,
    actorId: string,
    validFrom: Date = clockNow(),
  ): Promise<void> {
    await this.#transitionRegistration(moduleRegistrationId, tenantId, 'completed', actorId, validFrom);
  }

  async listTimetableRegistrations(
    tenantId: string,
    enrolmentId: string,
  ): Promise<TimetableRegistrationDto[]> {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx
        .select({
          registration: moduleRegistrations,
          offering: moduleOfferings,
          module: modules,
          period: academicPeriods,
        })
        .from(moduleRegistrations)
        .innerJoin(moduleOfferings, eq(moduleRegistrations.moduleOfferingId, moduleOfferings.id))
        .innerJoin(modules, eq(moduleOfferings.moduleId, modules.id))
        .innerJoin(academicPeriods, eq(moduleOfferings.academicPeriodId, academicPeriods.id))
        .where(
          and(
            eq(moduleRegistrations.enrolmentId, enrolmentId as `${string}-${string}-${string}-${string}-${string}`),
            eq(moduleRegistrations.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
            eq(moduleOfferings.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
            eq(modules.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
            eq(academicPeriods.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
            eq(moduleRegistrations.statusCode, 'registered'),
            isNull(moduleRegistrations.recordedUntil),
            isNull(modules.recordedUntil),
          ),
        )
        .orderBy(academicPeriods.startDate, modules.code),
    );

    return rows.map((row) => ({
      moduleRegistrationId: row.registration.id,
      enrolmentId: row.registration.enrolmentId,
      moduleOfferingId: row.offering.id,
      moduleId: row.module.id,
      moduleCode: row.module.code,
      moduleTitle: row.module.title,
      academicPeriodId: row.period.id,
      academicYear: row.period.academicYear,
      periodCode: row.period.periodCode,
      periodTypeCode: row.period.periodTypeCode,
      startDate: row.period.startDate,
      endDate: row.period.endDate,
      deliveryModeCode: row.offering.deliveryModeCode,
    }));
  }

  async #transitionRegistration(
    moduleRegistrationId: string,
    tenantId: string,
    newStatus: RegistrationStatusCode,
    actorId: string,
    validFrom: Date,
  ): Promise<void> {
    const current = await this.getRegistration(moduleRegistrationId, tenantId);
    if (!current) throw new NotFoundError('ModuleRegistration', moduleRegistrationId);
    if (current.statusCode !== 'registered') {
      throw new ValidationError(`Cannot transition module registration from '${current.statusCode}' to '${newStatus}'`);
    }

    const now = clockNow();
    await withTenantContext(this.db, tenantId, async (tx) => {
      await tx
        .update(moduleRegistrations)
        .set({ recordedUntil: now, validTo: validFrom })
        .where(
          and(
            eq(moduleRegistrations.id, moduleRegistrationId as `${string}-${string}-${string}-${string}-${string}`),
            eq(moduleRegistrations.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
            isNull(moduleRegistrations.recordedUntil),
          ),
        );

      await tx.insert(moduleRegistrations).values({
        versionId:        randomUUID(),
        id:               moduleRegistrationId as `${string}-${string}-${string}-${string}-${string}`,
        tenantId:         tenantId as `${string}-${string}-${string}-${string}-${string}`,
        enrolmentId:      current.enrolmentId as `${string}-${string}-${string}-${string}-${string}`,
        moduleOfferingId: current.moduleOfferingId as `${string}-${string}-${string}-${string}-${string}`,
        statusCode:       newStatus,
        registrationDate: current.registrationDate,
        validFrom,
        validTo:          null,
        recordedAt:       now,
        recordedUntil:    null,
      });
    });

    if (this.eventBus.isConnected()) {
      if (newStatus === 'withdrawn') {
        const payload: EnrolmentModuleRegistrationWithdrawnV1Payload = {
          enrolmentId: current.enrolmentId,
          moduleRegistrationId,
          moduleOfferingId: current.moduleOfferingId,
          withdrawnAt: validFrom.toISOString(),
        };
        await this.eventBus.publish(
          EVENT_TYPES.ENROLMENT_MODULE_REGISTRATION_WITHDRAWN,
          '1.0.0',
          tenantId,
          actorId,
          'personal',
          payload,
        );
      } else if (newStatus === 'completed') {
        const payload: EnrolmentModuleRegistrationCompletedV1Payload = {
          enrolmentId: current.enrolmentId,
          moduleRegistrationId,
          moduleOfferingId: current.moduleOfferingId,
          completedAt: validFrom.toISOString(),
        };
        await this.eventBus.publish(
          EVENT_TYPES.ENROLMENT_MODULE_REGISTRATION_COMPLETED,
          '1.0.0',
          tenantId,
          actorId,
          'personal',
          payload,
        );
      }
    }
  }

  async #getCurrentEnrolment(enrolmentId: string, tenantId: string): Promise<CurrentEnrolment> {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx
        .select({
          enrolmentId: enrolments.id,
          statusCode:  enrolments.statusCode,
          programmeId: enrolments.programmeId,
        })
        .from(enrolments)
        .where(
          and(
            eq(enrolments.id, enrolmentId as `${string}-${string}-${string}-${string}-${string}`),
            eq(enrolments.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
            isNull(enrolments.recordedUntil),
          ),
        )
        .limit(1),
    );

    const enrolment = rows[0];
    if (!enrolment) throw new NotFoundError('Enrolment', enrolmentId);
    return enrolment;
  }

  async #getOfferingContext(moduleOfferingId: string, tenantId: string): Promise<OfferingContext> {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx
        .select({
          moduleOfferingId: moduleOfferings.id,
          moduleId:         moduleOfferings.moduleId,
          academicPeriodId: moduleOfferings.academicPeriodId,
          capacity:         moduleOfferings.capacity,
          creditValue:      modules.creditValue,
          periodStartDate:  academicPeriods.startDate,
          periodEndDate:    academicPeriods.endDate,
        })
        .from(moduleOfferings)
        .innerJoin(academicPeriods, eq(moduleOfferings.academicPeriodId, academicPeriods.id))
        .innerJoin(modules, eq(moduleOfferings.moduleId, modules.id))
        .where(
          and(
            eq(moduleOfferings.id, moduleOfferingId as `${string}-${string}-${string}-${string}-${string}`),
            eq(moduleOfferings.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
            eq(academicPeriods.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
            eq(modules.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
            isNull(modules.recordedUntil),
          ),
        )
        .limit(1),
    );

    const offering = rows[0];
    if (!offering) throw new NotFoundError('ModuleOffering', moduleOfferingId);
    return offering;
  }

  async #ensureCreditLimitNotExceeded(
    enrolment: CurrentEnrolment,
    offering: OfferingContext,
    tenantId: string,
  ): Promise<void> {
    if (offering.creditValue === null) return;

    const maxCredits = await this.rules.getMaxCreditsPerPeriod({
      tenantId,
      programmeId: enrolment.programmeId ?? '',
    });
    if (maxCredits === null) return;

    const registeredCredits = await this.#sumRegisteredCreditsForPeriod(
      enrolment.enrolmentId,
      offering.academicPeriodId,
      tenantId,
    );

    if (registeredCredits + offering.creditValue > maxCredits) {
      throw new ValidationError(
        `Registration would exceed the maximum credit limit of ${maxCredits} for the period`,
        [{
          field: 'moduleOfferingId',
          message: `Adding ${offering.creditValue} credits would total ${registeredCredits + offering.creditValue}, exceeding the period limit of ${maxCredits}`,
        }],
      );
    }
  }

  async #sumRegisteredCreditsForPeriod(
    enrolmentId: string,
    academicPeriodId: string,
    tenantId: string,
  ): Promise<number> {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx
        .select({ creditValue: modules.creditValue })
        .from(moduleRegistrations)
        .innerJoin(moduleOfferings, eq(moduleRegistrations.moduleOfferingId, moduleOfferings.id))
        .innerJoin(modules, eq(moduleOfferings.moduleId, modules.id))
        .where(
          and(
            eq(moduleRegistrations.enrolmentId, enrolmentId as `${string}-${string}-${string}-${string}-${string}`),
            eq(moduleRegistrations.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
            eq(moduleOfferings.academicPeriodId, academicPeriodId as `${string}-${string}-${string}-${string}-${string}`),
            eq(moduleOfferings.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
            eq(modules.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
            eq(moduleRegistrations.statusCode, 'registered'),
            isNull(moduleRegistrations.recordedUntil),
            isNull(modules.recordedUntil),
          ),
        ),
    );

    return rows.reduce((sum, row) => sum + (row.creditValue ?? 0), 0);
  }

  #validateRegistrationWindow(registrationDate: string, offering: OfferingContext): void {
    if (registrationDate < offering.periodStartDate || registrationDate > offering.periodEndDate) {
      throw new ValidationError(
        'Registration date is outside the academic period registration window',
        [{ field: 'registrationDate', message: 'Date must fall within the offering academic period' }],
      );
    }
  }

  async #ensureNoDuplicateCurrentRegistration(
    enrolmentId: string,
    moduleOfferingId: string,
    tenantId: string,
  ): Promise<void> {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx
        .select({ id: moduleRegistrations.id })
        .from(moduleRegistrations)
        .where(
          and(
            eq(moduleRegistrations.enrolmentId, enrolmentId as `${string}-${string}-${string}-${string}-${string}`),
            eq(moduleRegistrations.moduleOfferingId, moduleOfferingId as `${string}-${string}-${string}-${string}-${string}`),
            eq(moduleRegistrations.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
            inArray(moduleRegistrations.statusCode, ['registered', 'completed']),
            isNull(moduleRegistrations.recordedUntil),
          ),
        )
        .limit(1),
    );

    if (rows.length > 0) {
      throw new ConflictError('Enrolment already has an active registration for this module offering');
    }
  }

  async #ensureCapacityAvailable(
    moduleOfferingId: string,
    capacity: number | null,
    tenantId: string,
  ): Promise<void> {
    if (capacity === null) return;

    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx
        .select({ id: moduleRegistrations.id })
        .from(moduleRegistrations)
        .where(
          and(
            eq(moduleRegistrations.moduleOfferingId, moduleOfferingId as `${string}-${string}-${string}-${string}-${string}`),
            eq(moduleRegistrations.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
            eq(moduleRegistrations.statusCode, 'registered'),
            isNull(moduleRegistrations.recordedUntil),
          ),
        ),
    );

    if (rows.length >= capacity) {
      throw new ConflictError('Module offering capacity has been reached');
    }
  }

  async #ensureModuleRulesSatisfied(
    enrolmentId: string,
    offering: OfferingContext,
    tenantId: string,
  ): Promise<void> {
    const relationships = await withTenantContext(this.db, tenantId, async (tx) =>
      tx
        .select()
        .from(moduleRelationships)
        .where(
          and(
            eq(moduleRelationships.moduleId, offering.moduleId as `${string}-${string}-${string}-${string}-${string}`),
            eq(moduleRelationships.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
            isNull(moduleRelationships.recordedUntil),
          ),
        ),
    );

    for (const relationship of relationships) {
      if (relationship.relationshipTypeCode === 'prerequisite') {
        const hasPrerequisite = await this.#hasRelatedRegistration(
          enrolmentId,
          relationship.relatedModuleId,
          tenantId,
          ['completed'],
        );
        if (!hasPrerequisite) {
          throw new ValidationError(
            'Module prerequisite has not been completed',
            [{ field: 'moduleOfferingId', message: 'A prerequisite module must be completed before registration' }],
          );
        }
      }

      if (relationship.relationshipTypeCode === 'co-requisite') {
        const hasCorequisite = await this.#hasRelatedRegistration(
          enrolmentId,
          relationship.relatedModuleId,
          tenantId,
          ['registered', 'completed'],
          offering.academicPeriodId,
        );
        if (!hasCorequisite) {
          throw new ValidationError(
            'Module co-requisite has not been registered',
            [{ field: 'moduleOfferingId', message: 'A co-requisite module must be registered in the same period' }],
          );
        }
      }

      if (relationship.relationshipTypeCode === 'exclusion') {
        const hasExcluded = await this.#hasRelatedRegistration(
          enrolmentId,
          relationship.relatedModuleId,
          tenantId,
          ['registered', 'completed'],
        );
        if (hasExcluded) {
          throw new ValidationError(
            'Module exclusion prevents registration',
            [{ field: 'moduleOfferingId', message: 'An excluded module is already registered or completed' }],
          );
        }
      }
    }
  }

  async #hasRelatedRegistration(
    enrolmentId: string,
    relatedModuleId: string,
    tenantId: string,
    statuses: RegistrationStatusCode[],
    academicPeriodId?: string,
  ): Promise<boolean> {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx
        .select({ id: moduleRegistrations.id })
        .from(moduleRegistrations)
        .innerJoin(moduleOfferings, eq(moduleRegistrations.moduleOfferingId, moduleOfferings.id))
        .where(
          and(
            eq(moduleRegistrations.enrolmentId, enrolmentId as `${string}-${string}-${string}-${string}-${string}`),
            eq(moduleRegistrations.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
            eq(moduleOfferings.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
            eq(moduleOfferings.moduleId, relatedModuleId as `${string}-${string}-${string}-${string}-${string}`),
            inArray(moduleRegistrations.statusCode, statuses),
            isNull(moduleRegistrations.recordedUntil),
            ...(academicPeriodId ? [eq(moduleOfferings.academicPeriodId, academicPeriodId as `${string}-${string}-${string}-${string}-${string}`)] : []),
          ),
        )
        .limit(1),
    );

    return rows.length > 0;
  }

  async #selectRegistration(moduleRegistrationId: string, tenantId: string, currentOnly: boolean) {
    return withTenantContext(this.db, tenantId, async (tx) =>
      tx
        .select({
          registration: moduleRegistrations,
          moduleId: moduleOfferings.moduleId,
          academicPeriodId: moduleOfferings.academicPeriodId,
        })
        .from(moduleRegistrations)
        .innerJoin(moduleOfferings, eq(moduleRegistrations.moduleOfferingId, moduleOfferings.id))
        .where(
          and(
            eq(moduleRegistrations.id, moduleRegistrationId as `${string}-${string}-${string}-${string}-${string}`),
            eq(moduleRegistrations.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
            eq(moduleOfferings.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
            ...(currentOnly ? [isNull(moduleRegistrations.recordedUntil)] : []),
          ),
        )
        .orderBy(moduleRegistrations.recordedAt),
    );
  }
}

function registrationToDto(
  row: typeof moduleRegistrations.$inferSelect,
  moduleId: string,
  academicPeriodId: string,
): ModuleRegistrationDto {
  return {
    moduleRegistrationId: row.id,
    enrolmentId: row.enrolmentId,
    moduleOfferingId: row.moduleOfferingId,
    moduleId,
    academicPeriodId,
    statusCode: row.statusCode,
    registrationDate: row.registrationDate,
    validFrom: row.validFrom,
    validTo: row.validTo,
    recordedAt: row.recordedAt,
    recordedUntil: row.recordedUntil,
  };
}
