import { randomUUID } from 'node:crypto';

import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import {
  academicPeriods,
  enrolments,
  moduleOfferings,
  moduleRegistrations,
  moduleRelationships,
  modules,
  workflowDefinitions,
  workflowDefinitionVersions,
  workflowInstances,
  workflowTasks,
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
import type { WorkflowBridgeService } from '../platform-controls/workflow-bridge-service.js';
import type { RulesEngine } from '../rules-engine/engine.js';
import { clockNow } from '../clock.js';
import type { RegistrationWindowService } from './window-service.js';

type Uuid = `${string}-${string}-${string}-${string}-${string}`;

const CHANGE_WORKFLOW_CODE = 'module-registration-change-approval';
const CHANGE_DECISION_STEP_KEY = 'approve-or-reject-registration-change';
const CHANGE_GATEWAY_KEY = 'G01';

export interface CreateModuleRegistrationInput {
  enrolmentId: string;
  moduleOfferingId: string;
  registrationDate?: string;
  validFrom?: Date;
  /**
   * Skips the offering capacity check. Set only when an authorised decision
   * has already accounted for capacity — e.g. a programme approver allocating
   * a waitlisted module selection proposal beyond nominal capacity
   * (BP-03-004 A5). All other checks (duplicate, prerequisite/co-requisite/
   * exclusion, credit limit) still apply.
   */
  skipCapacityCheck?: boolean;
}

export interface ModuleRegistrationDto {
  moduleRegistrationId: string;
  enrolmentId: string;
  moduleOfferingId: string;
  moduleId: string;
  moduleCode: string;
  moduleTitle: string;
  academicPeriodId: string;
  periodCode: string;
  creditValue: number | null;
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

export interface ChangeRequestDto {
  workflowInstanceId: string;
  workflowTaskId:      string;
  statusCode:          string;
  context:             Record<string, unknown>;
  startedAt:           Date;
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
}

export class ModuleRegistrationService {
  constructor(
    private readonly db: Db,
    private readonly eventBus: IntegrationBusPublisher,
    private readonly rules: RulesEngine,
    private readonly registrationWindows: RegistrationWindowService,
    private readonly workflowBridge: WorkflowBridgeService,
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

    await this.#validateRegistrationWindow(tenantId, offering.academicPeriodId);
    await this.#ensureNoDuplicateCurrentRegistration(input.enrolmentId, input.moduleOfferingId, tenantId);
    if (!input.skipCapacityCheck) {
      await this.#ensureCapacityAvailable(input.moduleOfferingId, offering.capacity, tenantId);
    }
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
          registration:    moduleRegistrations,
          moduleId:        moduleOfferings.moduleId,
          moduleCode:      modules.code,
          moduleTitle:     modules.title,
          creditValue:     modules.creditValue,
          academicPeriodId: moduleOfferings.academicPeriodId,
          periodCode:      academicPeriods.periodCode,
        })
        .from(moduleRegistrations)
        .innerJoin(moduleOfferings,  eq(moduleRegistrations.moduleOfferingId, moduleOfferings.id))
        .innerJoin(modules,          eq(moduleOfferings.moduleId,             modules.id))
        .innerJoin(academicPeriods,  eq(moduleOfferings.academicPeriodId,     academicPeriods.id))
        .where(
          and(
            eq(moduleRegistrations.tenantId,  tenantId as `${string}-${string}-${string}-${string}-${string}`),
            eq(moduleOfferings.tenantId,      tenantId as `${string}-${string}-${string}-${string}-${string}`),
            isNull(moduleRegistrations.recordedUntil),
            ...(opts.enrolmentId     ? [eq(moduleRegistrations.enrolmentId,    opts.enrolmentId     as `${string}-${string}-${string}-${string}-${string}`)] : []),
            ...(opts.moduleOfferingId ? [eq(moduleRegistrations.moduleOfferingId, opts.moduleOfferingId as `${string}-${string}-${string}-${string}-${string}`)] : []),
            ...(opts.statusCode      ? [eq(moduleRegistrations.statusCode,      opts.statusCode)] : []),
          ),
        )
        .orderBy(moduleRegistrations.registrationDate),
    );

    return rows.map((row) => registrationToDto(row.registration, row.moduleId, row.moduleCode, row.moduleTitle, row.academicPeriodId, row.periodCode, row.creditValue ?? null));
  }

  async getRegistration(moduleRegistrationId: string, tenantId: string): Promise<ModuleRegistrationDto | null> {
    const rows = await this.#selectRegistration(moduleRegistrationId, tenantId, true);
    const row = rows[0];
    return row ? registrationToDto(row.registration, row.moduleId, row.moduleCode, row.moduleTitle, row.academicPeriodId, row.periodCode, row.creditValue ?? null) : null;
  }

  async getRegistrationHistory(moduleRegistrationId: string, tenantId: string): Promise<ModuleRegistrationDto[]> {
    const rows = await this.#selectRegistration(moduleRegistrationId, tenantId, false);
    return rows.map((row) => registrationToDto(row.registration, row.moduleId, row.moduleCode, row.moduleTitle, row.academicPeriodId, row.periodCode, row.creditValue ?? null));
  }

  // ── Registration/withdrawal change requests (workflow-gated) ────────────────
  // Portal-initiated registration and withdrawal go through a personal-tutor
  // approval step rather than applying immediately. Staff-initiated direct
  // registration via createRegistration/withdrawRegistration above (e.g. the
  // admin console, or ModuleSelectionService confirming an approved
  // proposal) is unaffected.

  /**
   * Starts an approval workflow for a registration request. Runs no
   * business-rule validation itself — createRegistration re-validates
   * everything (window, capacity, prerequisites, credit limit) at decision
   * time, since state may have changed while the request was pending.
   */
  async requestRegistration(
    tenantId: string,
    input: CreateModuleRegistrationInput,
    requesterId: string,
    reason?: string,
  ): Promise<ChangeRequestDto> {
    const enrolment = await this.#getCurrentEnrolment(input.enrolmentId, tenantId);
    // Existence check only — confirms the offering is real before creating a
    // request an approver could never actually apply.
    await this.#getOfferingContext(input.moduleOfferingId, tenantId);

    return this.#startChangeRequest(tenantId, requesterId, {
      actionType: 'register',
      enrolmentId: input.enrolmentId,
      moduleOfferingId: input.moduleOfferingId,
      ...(input.registrationDate ? { registrationDate: input.registrationDate } : {}),
      ...(reason ? { reason } : {}),
    }, enrolment.enrolmentId);
  }

  /** Starts an approval workflow for a withdrawal request. */
  async requestWithdrawal(
    tenantId: string,
    moduleRegistrationId: string,
    requesterId: string,
    reason?: string,
  ): Promise<ChangeRequestDto> {
    const registration = await this.getRegistration(moduleRegistrationId, tenantId);
    if (!registration) throw new NotFoundError('ModuleRegistration', moduleRegistrationId);
    if (registration.statusCode !== 'registered') {
      throw new ValidationError(`Cannot request withdrawal for a registration in status '${registration.statusCode}'`);
    }

    return this.#startChangeRequest(tenantId, requesterId, {
      actionType: 'withdraw',
      moduleRegistrationId,
      ...(reason ? { reason } : {}),
    }, registration.enrolmentId);
  }

  /**
   * Lists pending (running) registration/withdrawal change requests, joined
   * with their approval task, for the staff approval queue.
   */
  async listPendingChangeRequests(tenantId: string): Promise<ChangeRequestDto[]> {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx.select({ instance: workflowInstances, task: workflowTasks })
        .from(workflowInstances)
        .innerJoin(workflowTasks, and(
          eq(workflowTasks.workflowInstanceId, workflowInstances.id),
          eq(workflowTasks.stepKey, CHANGE_DECISION_STEP_KEY),
        ))
        .where(and(
          eq(workflowInstances.tenantId, tenantId as Uuid),
          eq(workflowInstances.workflowCode, CHANGE_WORKFLOW_CODE),
          eq(workflowInstances.statusCode, 'running'),
        ))
        .orderBy(desc(workflowInstances.startedAt)),
    );
    return rows.map((r) => changeRequestToDto(r.instance, r.task));
  }

  /**
   * Lists change requests (any status) whose subject is one of the given
   * enrolments — the student-facing "my requests" view, scoped to the
   * caller's own enrolments by the route.
   */
  async listChangeRequestsForEnrolments(tenantId: string, enrolmentIds: string[]): Promise<ChangeRequestDto[]> {
    if (enrolmentIds.length === 0) return [];
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx.select({ instance: workflowInstances, task: workflowTasks })
        .from(workflowInstances)
        .innerJoin(workflowTasks, and(
          eq(workflowTasks.workflowInstanceId, workflowInstances.id),
          eq(workflowTasks.stepKey, CHANGE_DECISION_STEP_KEY),
        ))
        .where(and(
          eq(workflowInstances.tenantId, tenantId as Uuid),
          eq(workflowInstances.workflowCode, CHANGE_WORKFLOW_CODE),
          inArray(workflowInstances.subjectEntityId, enrolmentIds as Uuid[]),
        ))
        .orderBy(desc(workflowInstances.startedAt)),
    );
    return rows.map((r) => changeRequestToDto(r.instance, r.task));
  }

  /**
   * Records the approval/rejection decision. On approval, applies the
   * change by calling createRegistration/withdrawRegistration — the same
   * validated path staff use directly — so a request that has become
   * invalid since submission (window closed, capacity gone) still fails
   * loudly rather than silently succeeding.
   */
  async decideChangeRequest(
    tenantId: string,
    workflowInstanceId: string,
    decisionCode: 'approved' | 'rejected',
    actorId: string,
    reason?: string,
  ): Promise<{ moduleRegistrationId: string | null }> {
    const instance = await this.#getChangeRequestInstance(tenantId, workflowInstanceId);
    if (instance.statusCode !== 'running') {
      throw new ValidationError(`Cannot decide a change request in status '${instance.statusCode}'`);
    }

    const task = await this.#findChangeDecisionTask(tenantId, workflowInstanceId);

    await this.workflowBridge.recordWorkflowDecision({
      tenantId,
      workflowInstanceId,
      gatewayKey: CHANGE_GATEWAY_KEY,
      decisionCode,
      ...(reason ? { conditionSummary: reason } : {}),
      outcomeStepKey: 'request-closed',
      actorId,
      metadata: { context: instance.context },
    });
    if (task) {
      await this.workflowBridge.completeWorkflowTask({
        tenantId, workflowTaskId: task.id, completedBy: actorId,
        payload: { decisionCode, ...(reason ? { reason } : {}) },
      });
    }
    await this.workflowBridge.completeWorkflowInstance({
      tenantId, workflowInstanceId, actorId,
      statusCode: 'completed', metadata: { decisionCode },
    });

    if (decisionCode !== 'approved') return { moduleRegistrationId: null };

    const context = instance.context as {
      actionType: 'register' | 'withdraw';
      enrolmentId?: string;
      moduleOfferingId?: string;
      registrationDate?: string;
      moduleRegistrationId?: string;
    };

    if (context.actionType === 'register') {
      const moduleRegistrationId = await this.createRegistration(tenantId, {
        enrolmentId: context.enrolmentId!,
        moduleOfferingId: context.moduleOfferingId!,
        ...(context.registrationDate ? { registrationDate: context.registrationDate } : {}),
      }, actorId);
      return { moduleRegistrationId };
    }

    await this.withdrawRegistration(context.moduleRegistrationId!, tenantId, actorId);
    return { moduleRegistrationId: context.moduleRegistrationId! };
  }

  async #startChangeRequest(
    tenantId: string,
    requesterId: string,
    context: Record<string, unknown>,
    subjectEntityId: string,
  ): Promise<ChangeRequestDto> {
    const workflowDefinitionVersionId = await this.#getActiveChangeWorkflowVersionId(tenantId);
    const instance = await this.workflowBridge.startWorkflowInstance({
      tenantId,
      workflowDefinitionVersionId,
      workflowCode: CHANGE_WORKFLOW_CODE,
      subjectEntityType: 'enrolment',
      subjectEntityId,
      startedBy: requesterId,
      context,
    });

    const task = await this.workflowBridge.assignWorkflowTask({
      tenantId,
      workflowInstanceId: instance.workflowInstanceId,
      stepKey: CHANGE_DECISION_STEP_KEY,
      assigneeRoleCode: 'personal-tutor',
      payload: context,
    });

    return {
      workflowInstanceId: instance.workflowInstanceId,
      workflowTaskId: task.workflowTaskId,
      statusCode: 'running',
      context,
      startedAt: clockNow(),
    };
  }

  async #getChangeRequestInstance(tenantId: string, workflowInstanceId: string) {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx.select().from(workflowInstances).where(and(
        eq(workflowInstances.id, workflowInstanceId as Uuid),
        eq(workflowInstances.tenantId, tenantId as Uuid),
        eq(workflowInstances.workflowCode, CHANGE_WORKFLOW_CODE),
      )).limit(1),
    );
    if (!rows[0]) throw new NotFoundError('WorkflowInstance', workflowInstanceId);
    return rows[0];
  }

  async #findChangeDecisionTask(tenantId: string, workflowInstanceId: string) {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx.select().from(workflowTasks).where(and(
        eq(workflowTasks.workflowInstanceId, workflowInstanceId as Uuid),
        eq(workflowTasks.tenantId, tenantId as Uuid),
        eq(workflowTasks.stepKey, CHANGE_DECISION_STEP_KEY),
      )).limit(1),
    );
    return rows[0] ?? null;
  }

  async #getActiveChangeWorkflowVersionId(tenantId: string): Promise<string> {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx.select({ versionId: workflowDefinitionVersions.id })
        .from(workflowDefinitions)
        .innerJoin(
          workflowDefinitionVersions,
          and(
            eq(workflowDefinitionVersions.workflowDefinitionId, workflowDefinitions.id),
            eq(workflowDefinitionVersions.versionNumber, workflowDefinitions.currentVersionNumber),
          ),
        )
        .where(and(
          eq(workflowDefinitions.definitionCode, CHANGE_WORKFLOW_CODE),
          eq(workflowDefinitions.statusCode, 'active'),
          eq(workflowDefinitionVersions.statusCode, 'active'),
        ))
        .limit(1),
    );
    if (!rows[0]) throw new NotFoundError('WorkflowDefinition', CHANGE_WORKFLOW_CODE);
    return rows[0].versionId;
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
        })
        .from(moduleOfferings)
        .innerJoin(modules, eq(moduleOfferings.moduleId, modules.id))
        .where(
          and(
            eq(moduleOfferings.id, moduleOfferingId as `${string}-${string}-${string}-${string}-${string}`),
            eq(moduleOfferings.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
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

  /**
   * Only enforced when the tenant has opted in via
   * configuration.registrationWindowMode === 'academic-period'. Tenants that
   * leave it unset keep the previous unrestricted behaviour.
   */
  async #validateRegistrationWindow(tenantId: string, academicPeriodId: string): Promise<void> {
    const mode = await this.registrationWindows.getEnforcementMode(tenantId);
    if (mode !== 'academic-period') return;

    const window = await this.registrationWindows.getWindowForPeriod(tenantId, academicPeriodId);
    if (!window) {
      throw new ValidationError(
        'No registration window is configured for this academic period',
        [{ field: 'moduleOfferingId', message: 'An administrator must configure a registration window before students can register' }],
      );
    }

    const now = clockNow();
    if (now < window.opensAt || now > window.closesAt) {
      throw new ValidationError(
        'The registration window for this academic period is not open',
        [{ field: 'moduleOfferingId', message: `Registration is open from ${window.opensAt.toISOString()} to ${window.closesAt.toISOString()}` }],
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
          registration:    moduleRegistrations,
          moduleId:        moduleOfferings.moduleId,
          moduleCode:      modules.code,
          moduleTitle:     modules.title,
          creditValue:     modules.creditValue,
          academicPeriodId: moduleOfferings.academicPeriodId,
          periodCode:      academicPeriods.periodCode,
        })
        .from(moduleRegistrations)
        .innerJoin(moduleOfferings,  eq(moduleRegistrations.moduleOfferingId, moduleOfferings.id))
        .innerJoin(modules,          eq(moduleOfferings.moduleId,             modules.id))
        .innerJoin(academicPeriods,  eq(moduleOfferings.academicPeriodId,     academicPeriods.id))
        .where(
          and(
            eq(moduleRegistrations.id,       moduleRegistrationId as `${string}-${string}-${string}-${string}-${string}`),
            eq(moduleRegistrations.tenantId, tenantId             as `${string}-${string}-${string}-${string}-${string}`),
            eq(moduleOfferings.tenantId,     tenantId             as `${string}-${string}-${string}-${string}-${string}`),
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
  moduleCode: string,
  moduleTitle: string,
  academicPeriodId: string,
  periodCode: string,
  creditValue: number | null,
): ModuleRegistrationDto {
  return {
    moduleRegistrationId: row.id,
    enrolmentId: row.enrolmentId,
    moduleOfferingId: row.moduleOfferingId,
    moduleId,
    moduleCode,
    moduleTitle,
    academicPeriodId,
    periodCode,
    creditValue,
    statusCode: row.statusCode,
    registrationDate: row.registrationDate,
    validFrom: row.validFrom,
    validTo: row.validTo,
    recordedAt: row.recordedAt,
    recordedUntil: row.recordedUntil,
  };
}

function changeRequestToDto(
  instance: typeof workflowInstances.$inferSelect,
  task: typeof workflowTasks.$inferSelect,
): ChangeRequestDto {
  return {
    workflowInstanceId: instance.id,
    workflowTaskId:      task.id,
    statusCode:          instance.statusCode,
    context:             instance.context,
    startedAt:           instance.startedAt,
  };
}
