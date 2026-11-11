import { and, eq, inArray, isNotNull, lt } from 'drizzle-orm';
import {
  workflowTasks,
  workflowInstances,
  workflowSteps,
  type Db,
  withTenantContext,
} from '@revelation-srs/db';

import { clockNow } from '../clock.js';

import type { WorkflowBridgeService } from './workflow-bridge-service.js';

/**
 * Enforces the due-date/escalation policy that every workflow task carries
 * as data but that nothing in this codebase acted on automatically until
 * now (escalateWorkflowTask previously had exactly one caller: a manual
 * button in PGR progress review). Exposed as an idempotent sweep endpoint
 * meant for external scheduling (a cron job / k8s CronJob), matching the
 * codebase's existing pattern for this kind of concern (see the regulatory
 * downstream-trigger "drain" endpoints) rather than an in-process timer.
 *
 * Idempotency is structural, not a separate marker: escalateWorkflowTask
 * moves a task's statusCode to 'escalated', which drops it out of this
 * sweep's own status filter — so a task is escalated (and, if the step
 * configured an escalateToRoleCode, reassigned) at most once, however many
 * times the sweep subsequently runs while it remains unactioned.
 */

const OVERDUE_STATUS_CODES = ['pending', 'assigned', 'in-progress'];

export interface EscalationSweepResult {
  escalatedTaskIds: string[];
}

export class WorkflowEscalationService {
  constructor(
    private readonly db: Db,
    private readonly workflowBridge: WorkflowBridgeService,
  ) {}

  async sweepOverdueTasks(tenantId: string): Promise<EscalationSweepResult> {
    const now = clockNow();
    const overdue = await withTenantContext(this.db, tenantId, async (tx) =>
      tx.select({
        workflowTaskId:   workflowTasks.id,
        stepConfiguration: workflowSteps.configuration,
      })
        .from(workflowTasks)
        .innerJoin(workflowInstances, eq(workflowTasks.workflowInstanceId, workflowInstances.id))
        .innerJoin(workflowSteps, and(
          eq(workflowSteps.workflowDefinitionVersionId, workflowInstances.workflowDefinitionVersionId),
          eq(workflowSteps.stepKey, workflowTasks.stepKey),
        ))
        .where(and(
          eq(workflowTasks.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
          inArray(workflowTasks.statusCode, OVERDUE_STATUS_CODES),
          isNotNull(workflowTasks.dueAt),
          lt(workflowTasks.dueAt, now),
          // Temporal-run reviews own their own deadline timer; the sweep must
          // not make a competing change to them.
          eq(workflowInstances.executionBackend, 'legacy'),
        )),
    );

    const escalatedTaskIds: string[] = [];
    for (const task of overdue) {
      const escalateToRoleCode = typeof task.stepConfiguration['escalateToRoleCode'] === 'string'
        ? task.stepConfiguration['escalateToRoleCode']
        : undefined;
      await this.workflowBridge.escalateWorkflowTask({
        tenantId,
        workflowTaskId: task.workflowTaskId,
        reasonCode: 'deadline-expired',
        ...(escalateToRoleCode ? { escalatedToRoleCode: escalateToRoleCode } : {}),
      });
      escalatedTaskIds.push(task.workflowTaskId);
    }
    return { escalatedTaskIds };
  }
}
