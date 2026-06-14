import { and, eq } from 'drizzle-orm';
import {
  workflowDefinitions,
  workflowDefinitionVersions,
  type Db,
  withTenantContext,
} from '@revelation-srs/db';
import { NotFoundError } from '@revelation-srs/domain';

import type { WorkflowBridgeService } from '../platform-controls/workflow-bridge-service.js';

// ── Source codes and workflow mapping ─────────────────────────────────────────

export type AdmissionSourceCode =
  | 'ucas'
  | 'direct'
  | 'agent'
  | 'international-direct'
  | 'international-agent'
  | 'clearing';

const SOURCE_WORKFLOW: Record<AdmissionSourceCode, string> = {
  'ucas':                'admissions-ucas-domestic',
  'direct':              'admissions-direct-domestic',
  'agent':               'admissions-international-agent',
  'international-direct':'admissions-international-direct',
  'international-agent': 'admissions-international-agent',
  'clearing':            'admissions-clearing',
};

const HANDOFF_STEP_KEY = 'handoff-to-srs-enrolment';

// ── DTOs ─────────────────────────────────────────────────────────────────────

export interface AdmissionsHandoffInput {
  applicationId:              string;
  sourceApplicationReference: string;
  source:                     AdmissionSourceCode;
  cycle?:                     string;
  statusCode:                 string;
  rawPayload:                 Record<string, unknown>;
}

export interface AdmissionsHandoffResult {
  workflowInstanceId: string;
  workflowTaskId:     string;
  workflowCode:       string;
}

// ── Service ───────────────────────────────────────────────────────────────────

/**
 * Source-neutral Admissions service.
 *
 * All five admission routes (UCAS domestic, direct domestic, international
 * direct, international agent, clearing) enter the same command surface.
 * The source code selects which workflow definition handles the handoff.
 *
 * UcasService calls this service; so do future direct/agent/clearing adapters.
 * UCAS is one adapter, not a process owner.
 */
export class AdmissionsService {
  constructor(
    private readonly db:             Db,
    private readonly workflowBridge: WorkflowBridgeService,
  ) {}

  async startHandoff(
    tenantId: string,
    input:    AdmissionsHandoffInput,
    actorId:  string,
  ): Promise<AdmissionsHandoffResult> {
    const workflowCode = SOURCE_WORKFLOW[input.source];
    const workflowDefinitionVersionId = await this.#getActiveVersionId(tenantId, workflowCode);

    const instance = await this.workflowBridge.startWorkflowInstance({
      tenantId,
      workflowDefinitionVersionId,
      workflowCode,
      subjectEntityType: this.#entityTypeForSource(input.source),
      subjectEntityId:   input.applicationId,
      startedBy:         actorId,
      context: {
        sourceSystemCode:              input.source,
        sourceApplicationReference:    input.sourceApplicationReference,
        ...(input.cycle ? { cycle: input.cycle } : {}),
        statusCode:                    input.statusCode,
        handoffStepKey:                HANDOFF_STEP_KEY,
      },
    });

    await this.workflowBridge.recordWorkflowDecision({
      tenantId,
      workflowInstanceId: instance.workflowInstanceId,
      gatewayKey:         'G03',
      decisionCode:       'confirmed-for-handoff',
      conditionSummary:
        `${input.source} application confirmed; enrolment conversion delegated to Admissions workflow.`,
      outcomeStepKey: HANDOFF_STEP_KEY,
      actorId,
      metadata: {
        applicationId:              input.applicationId,
        source:                     input.source,
        sourceApplicationReference: input.sourceApplicationReference,
        ...(input.cycle ? { cycle: input.cycle } : {}),
      },
    });

    const task = await this.workflowBridge.assignWorkflowTask({
      tenantId,
      workflowInstanceId: instance.workflowInstanceId,
      stepKey:            HANDOFF_STEP_KEY,
      assigneeRoleCode:   'registry-administrator',
      payload: {
        applicationId:              input.applicationId,
        sourceSystemCode:           input.source,
        sourceApplicationReference: input.sourceApplicationReference,
        ...(input.cycle ? { cycle: input.cycle } : {}),
        handoffMode: 'workflow',
      },
    });

    return {
      workflowInstanceId: instance.workflowInstanceId,
      workflowTaskId:     task.workflowTaskId,
      workflowCode,
    };
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  async #getActiveVersionId(tenantId: string, definitionCode: string): Promise<string> {
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
          eq(workflowDefinitions.definitionCode, definitionCode),
          eq(workflowDefinitions.statusCode, 'active'),
          eq(workflowDefinitionVersions.statusCode, 'active'),
        ))
        .limit(1),
    );
    if (!rows[0]) throw new NotFoundError('WorkflowDefinition', definitionCode);
    return rows[0].versionId;
  }

  #entityTypeForSource(source: AdmissionSourceCode): string {
    if (source === 'ucas') return 'ucas_application';
    if (source === 'clearing') return 'clearing_application';
    return 'admissions_application';
  }
}
