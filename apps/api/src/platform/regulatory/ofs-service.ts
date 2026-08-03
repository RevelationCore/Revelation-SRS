import { randomUUID } from 'node:crypto';

import { and, desc, eq, sql } from 'drizzle-orm';
import {
  ofsExtracts,
  workflowDefinitions,
  workflowDefinitionVersions,
  workflowInstances,
  workflowTasks,
  type Db,
  type OfsExtract,
  withTenantContext,
} from '@revelation-srs/db';
import {
  EVENT_TYPES,
  NotFoundError,
  ValidationError,
  type RegulatoryOfsExtractGeneratedV1Payload,
} from '@revelation-srs/domain';

import type { WorkflowBridgeService } from '../platform-controls/workflow-bridge-service.js';
import type { IntegrationBusPublisher } from '../integration-bus/publisher.js';
import { clockNow } from '../clock.js';

type Uuid = `${string}-${string}-${string}-${string}-${string}`;
type OfsExtractTypeCode = 'b3-student-outcomes' | 'access-participation-progress';

const OFS_GENERATION_WORKFLOW_CODE = 'ofs-extract-generation-approval';
const OFS_GENERATION_DECISION_STEP_KEY = 'approve-or-reject-generation';
const OFS_GENERATION_GATEWAY_KEY = 'G01';

export interface OfsGenerationRequestDto {
  workflowInstanceId: string;
  workflowTaskId:      string;
  statusCode:          string;
  context:             Record<string, unknown>;
  startedAt:           Date;
}

interface B3MetricRow {
  total_enrolments: number | string;
  continuation_count: number | string;
  completion_count: number | string;
  progression_count: number | string;
}

interface ParticipationRow {
  polar4_quintile: number | null;
  imd_decile: number | null;
  care_experienced: boolean | null;
  declared_disability: boolean | null;
  student_count: number | string;
  continuation_count: number | string;
  completion_count: number | string;
}

export interface OfsExtractDto {
  extractId: string;
  extractTypeCode: string;
  academicYear: string;
  generatedAt: Date;
  generatedBy: string;
  recordCount: number;
  statusCode: string;
  payload: Record<string, unknown>;
}

export class OfsService {
  constructor(
    private readonly db: Db,
    private readonly eventBus: IntegrationBusPublisher,
    private readonly workflowBridge?: WorkflowBridgeService,
  ) {}

  async generateB3Extract(
    tenantId: string,
    academicYear: string,
    actorId: string,
  ): Promise<{ extractId: string; recordCount: number; payload: Record<string, unknown> }> {
    const now = clockNow();
    const metrics = await this.#loadB3Metrics(tenantId, academicYear);
    const total = toNumber(metrics.total_enrolments);
    const payload = {
      extractTypeCode: 'b3-student-outcomes',
      academicYear,
      generatedAt: now.toISOString(),
      metrics: {
        continuation: {
          denominator: total,
          numerator: toNumber(metrics.continuation_count),
          rate: rate(toNumber(metrics.continuation_count), total),
        },
        completion: {
          denominator: total,
          numerator: toNumber(metrics.completion_count),
          rate: rate(toNumber(metrics.completion_count), total),
        },
        progression: {
          denominator: total,
          numerator: toNumber(metrics.progression_count),
          rate: rate(toNumber(metrics.progression_count), total),
        },
      },
      dataQualityNotes: [
        'Progression metric uses current awards and progression decisions available in SRS.',
        'Employment and further-study destinations require downstream graduate-outcomes integration.',
      ],
    };

    const extractId = await this.#insertExtract(
      tenantId,
      'b3-student-outcomes',
      academicYear,
      total,
      payload,
      actorId,
      now,
    );
    await this.#publishExtractGenerated(tenantId, actorId, {
      extractId,
      extractTypeCode: 'b3-student-outcomes',
      academicYear,
      recordCount: total,
      generatedAt: now.toISOString(),
    });

    return { extractId, recordCount: total, payload };
  }

  async generateParticipationReport(
    tenantId: string,
    academicYear: string,
    actorId: string,
  ): Promise<{ extractId: string; recordCount: number; payload: Record<string, unknown> }> {
    const now = clockNow();
    const rows = await this.#loadParticipationRows(tenantId, academicYear);
    const segments = rows.map((row) => {
      const total = toNumber(row.student_count);
      return {
        polar4Quintile: row.polar4_quintile ?? 'unknown',
        imdDecile: row.imd_decile ?? 'unknown',
        careExperienced: row.care_experienced ?? 'unknown',
        declaredDisability: row.declared_disability ?? 'unknown',
        studentCount: total,
        continuationRate: rate(toNumber(row.continuation_count), total),
        completionRate: rate(toNumber(row.completion_count), total),
      };
    });
    const recordCount = segments.reduce((sum, segment) => sum + segment.studentCount, 0);
    const payload = {
      extractTypeCode: 'access-participation-progress',
      academicYear,
      generatedAt: now.toISOString(),
      segments,
      dataQualityNotes: [
        'Missing POLAR4, IMD, care-experienced, and disability values are emitted as unknown.',
        'Participation segmentation is sourced only from student_regulatory_profile and disability declarations.',
      ],
    };

    const extractId = await this.#insertExtract(
      tenantId,
      'access-participation-progress',
      academicYear,
      recordCount,
      payload,
      actorId,
      now,
    );
    await this.#publishExtractGenerated(tenantId, actorId, {
      extractId,
      extractTypeCode: 'access-participation-progress',
      academicYear,
      recordCount,
      generatedAt: now.toISOString(),
    });

    return { extractId, recordCount, payload };
  }

  async getExtract(extractId: string, tenantId: string): Promise<OfsExtractDto> {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx
        .select()
        .from(ofsExtracts)
        .where(and(eq(ofsExtracts.id, extractId), eq(ofsExtracts.tenantId, tenantId)))
        .limit(1),
    );

    if (!rows[0]) throw new NotFoundError('OfS extract', extractId);
    return toDto(rows[0]);
  }

  // ── Generation approval workflow ────────────────────────────────────────────
  // OfS has no existing submit/transmit step at all (unlike SLC/HESA/UCAS/
  // UKVI) — the admin console's only further action after generation is a
  // client-side JSON download. There is nothing to gate before transmission
  // because there is no transmission step in this codebase. The workflow
  // gate is therefore placed before the one meaningful mutating action that
  // does exist: creating the official extract record. Unlike SLC, there is
  // no "preview" to snapshot and re-use at decision time — B3/participation
  // extracts are live aggregate statistics, so re-deriving them fresh at
  // approval time (rather than reusing whatever was true when requested) is
  // the correct behaviour here, not a bug to guard against.

  async requestExtractGeneration(
    tenantId: string,
    extractTypeCode: OfsExtractTypeCode,
    academicYear: string,
    requesterId: string,
    reason?: string,
  ): Promise<OfsGenerationRequestDto> {
    if (!this.workflowBridge) throw new ValidationError('OfS extract generation workflow is not configured');

    const context: Record<string, unknown> = { extractTypeCode, academicYear, ...(reason ? { reason } : {}) };

    const workflowDefinitionVersionId = await this.#getActiveGenerationWorkflowVersionId(tenantId);
    const instance = await this.workflowBridge.startWorkflowInstance({
      tenantId,
      workflowDefinitionVersionId,
      workflowCode: OFS_GENERATION_WORKFLOW_CODE,
      subjectEntityType: 'ofs_extract',
      startedBy: requesterId,
      context,
    });

    const task = await this.workflowBridge.assignWorkflowTask({
      tenantId,
      workflowInstanceId: instance.workflowInstanceId,
      stepKey: OFS_GENERATION_DECISION_STEP_KEY,
      assigneeRoleCode: 'regulatory-officer',
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

  async listPendingGenerationRequests(tenantId: string): Promise<OfsGenerationRequestDto[]> {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx.select({ instance: workflowInstances, task: workflowTasks })
        .from(workflowInstances)
        .innerJoin(workflowTasks, and(
          eq(workflowTasks.workflowInstanceId, workflowInstances.id),
          eq(workflowTasks.stepKey, OFS_GENERATION_DECISION_STEP_KEY),
        ))
        .where(and(
          eq(workflowInstances.tenantId, tenantId as Uuid),
          eq(workflowInstances.workflowCode, OFS_GENERATION_WORKFLOW_CODE),
          eq(workflowInstances.statusCode, 'running'),
        ))
        .orderBy(desc(workflowInstances.startedAt)),
    );
    return rows.map((r) => ofsGenerationRequestToDto(r.instance, r.task));
  }

  async decideExtractGeneration(
    tenantId: string,
    workflowInstanceId: string,
    decisionCode: 'approved' | 'rejected',
    actorId: string,
    reason?: string,
  ): Promise<{ extractId: string | null }> {
    if (!this.workflowBridge) throw new ValidationError('OfS extract generation workflow is not configured');

    const instance = await this.#getGenerationInstance(tenantId, workflowInstanceId);
    if (instance.statusCode !== 'running') {
      throw new ValidationError(`Cannot decide a generation request in status '${instance.statusCode}'`);
    }

    const task = await this.#findGenerationDecisionTask(tenantId, workflowInstanceId);

    await this.workflowBridge.recordWorkflowDecision({
      tenantId,
      workflowInstanceId,
      gatewayKey: OFS_GENERATION_GATEWAY_KEY,
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

    if (decisionCode !== 'approved') return { extractId: null };

    const context = instance.context as { extractTypeCode: OfsExtractTypeCode; academicYear: string };
    const result = context.extractTypeCode === 'b3-student-outcomes'
      ? await this.generateB3Extract(tenantId, context.academicYear, actorId)
      : await this.generateParticipationReport(tenantId, context.academicYear, actorId);
    return { extractId: result.extractId };
  }

  async #getActiveGenerationWorkflowVersionId(tenantId: string): Promise<string> {
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
          eq(workflowDefinitions.definitionCode, OFS_GENERATION_WORKFLOW_CODE),
          eq(workflowDefinitions.statusCode, 'active'),
          eq(workflowDefinitionVersions.statusCode, 'active'),
        ))
        .limit(1),
    );
    if (!rows[0]) throw new NotFoundError('WorkflowDefinition', OFS_GENERATION_WORKFLOW_CODE);
    return rows[0].versionId;
  }

  async #getGenerationInstance(tenantId: string, workflowInstanceId: string) {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx.select().from(workflowInstances).where(and(
        eq(workflowInstances.id, workflowInstanceId as Uuid),
        eq(workflowInstances.tenantId, tenantId as Uuid),
        eq(workflowInstances.workflowCode, OFS_GENERATION_WORKFLOW_CODE),
      )).limit(1),
    );
    if (!rows[0]) throw new NotFoundError('WorkflowInstance', workflowInstanceId);
    return rows[0];
  }

  async #findGenerationDecisionTask(tenantId: string, workflowInstanceId: string) {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx.select().from(workflowTasks).where(and(
        eq(workflowTasks.workflowInstanceId, workflowInstanceId as Uuid),
        eq(workflowTasks.tenantId, tenantId as Uuid),
        eq(workflowTasks.stepKey, OFS_GENERATION_DECISION_STEP_KEY),
      )).limit(1),
    );
    return rows[0] ?? null;
  }

  async #insertExtract(
    tenantId: string,
    extractTypeCode: string,
    academicYear: string,
    recordCount: number,
    payload: Record<string, unknown>,
    actorId: string,
    generatedAt: Date,
  ): Promise<string> {
    const extractId = randomUUID();
    await withTenantContext(this.db, tenantId, async (tx) => {
      await tx.insert(ofsExtracts).values({
        id: extractId,
        tenantId,
        extractTypeCode,
        academicYear,
        generatedAt,
        generatedBy: actorId,
        recordCount,
        extractPayload: payload,
        statusCode: 'generated',
      });
    });
    return extractId;
  }

  async #loadB3Metrics(tenantId: string, academicYear: string): Promise<B3MetricRow> {
    const rows = (await withTenantContext(this.db, tenantId, async (tx) =>
      tx.execute(sql`
        WITH cohort AS (
          SELECT e.id AS enrolment_id, e.status_code
          FROM enrolment e
          WHERE e.tenant_id = ${tenantId}
            AND e.academic_year_of_entry = ${academicYear}
            AND e.recorded_until IS NULL
        ),
        awarded AS (
          SELECT DISTINCT enrolment_id
          FROM award
          WHERE tenant_id = ${tenantId}
            AND recorded_until IS NULL
        ),
        progressed AS (
          SELECT DISTINCT enrolment_id
          FROM progression_decision
          WHERE tenant_id = ${tenantId}
            AND academic_year = ${academicYear}
            AND recorded_until IS NULL
            AND decision_code = 'progress'
        )
        SELECT
          COUNT(*) AS total_enrolments,
          COUNT(*) FILTER (WHERE cohort.status_code NOT IN ('withdrawn')) AS continuation_count,
          COUNT(*) FILTER (WHERE awarded.enrolment_id IS NOT NULL) AS completion_count,
          COUNT(*) FILTER (
            WHERE awarded.enrolment_id IS NOT NULL OR progressed.enrolment_id IS NOT NULL
          ) AS progression_count
        FROM cohort
        LEFT JOIN awarded ON awarded.enrolment_id = cohort.enrolment_id
        LEFT JOIN progressed ON progressed.enrolment_id = cohort.enrolment_id
      `),
    )) as unknown as B3MetricRow[];
    return rows[0] ?? {
      total_enrolments: 0,
      continuation_count: 0,
      completion_count: 0,
      progression_count: 0,
    };
  }

  async #loadParticipationRows(tenantId: string, academicYear: string): Promise<ParticipationRow[]> {
    return (await withTenantContext(this.db, tenantId, async (tx) =>
      tx.execute(sql`
        WITH cohort AS (
          SELECT e.id AS enrolment_id, e.person_id, e.status_code
          FROM enrolment e
          WHERE e.tenant_id = ${tenantId}
            AND e.academic_year_of_entry = ${academicYear}
            AND e.recorded_until IS NULL
        ),
        profiles AS (
          SELECT DISTINCT ON (enrolment_id)
            enrolment_id,
            polar4_quintile,
            imd_decile,
            care_experienced
          FROM student_regulatory_profile
          WHERE tenant_id = ${tenantId}
            AND recorded_until IS NULL
            AND enrolment_id IS NOT NULL
          ORDER BY enrolment_id, recorded_at DESC
        ),
        disability AS (
          SELECT DISTINCT person_id
          FROM disability_declaration
          WHERE tenant_id = ${tenantId}
            AND recorded_until IS NULL
            AND declaration_status_code = 'declared'
        ),
        awarded AS (
          SELECT DISTINCT enrolment_id
          FROM award
          WHERE tenant_id = ${tenantId}
            AND recorded_until IS NULL
        )
        SELECT
          profiles.polar4_quintile,
          profiles.imd_decile,
          profiles.care_experienced,
          (disability.person_id IS NOT NULL) AS declared_disability,
          COUNT(*) AS student_count,
          COUNT(*) FILTER (WHERE cohort.status_code NOT IN ('withdrawn')) AS continuation_count,
          COUNT(*) FILTER (WHERE awarded.enrolment_id IS NOT NULL) AS completion_count
        FROM cohort
        LEFT JOIN profiles ON profiles.enrolment_id = cohort.enrolment_id
        LEFT JOIN disability ON disability.person_id = cohort.person_id
        LEFT JOIN awarded ON awarded.enrolment_id = cohort.enrolment_id
        GROUP BY
          profiles.polar4_quintile,
          profiles.imd_decile,
          profiles.care_experienced,
          declared_disability
        ORDER BY profiles.polar4_quintile NULLS LAST, profiles.imd_decile NULLS LAST
      `),
    )) as unknown as ParticipationRow[];
  }

  async #publishExtractGenerated(
    tenantId: string,
    actorId: string,
    payload: RegulatoryOfsExtractGeneratedV1Payload,
  ): Promise<void> {
    if (!this.eventBus.isConnected()) return;
    await this.eventBus.publish(EVENT_TYPES.REGULATORY_OFS_EXTRACT_GENERATED, '1.0.0', tenantId, actorId, 'regulatory', payload);
  }
}

function toDto(row: OfsExtract): OfsExtractDto {
  return {
    extractId: row.id,
    extractTypeCode: row.extractTypeCode,
    academicYear: row.academicYear,
    generatedAt: row.generatedAt,
    generatedBy: row.generatedBy,
    recordCount: row.recordCount,
    statusCode: row.statusCode,
    payload: row.extractPayload,
  };
}

function toNumber(value: number | string): number {
  return typeof value === 'number' ? value : Number(value);
}

function rate(numerator: number, denominator: number): number | null {
  if (denominator === 0) return null;
  return Number((numerator / denominator).toFixed(4));
}

function ofsGenerationRequestToDto(
  instance: typeof workflowInstances.$inferSelect,
  task: typeof workflowTasks.$inferSelect,
): OfsGenerationRequestDto {
  return {
    workflowInstanceId: instance.id,
    workflowTaskId:      task.id,
    statusCode:          instance.statusCode,
    context:             instance.context,
    startedAt:           instance.startedAt,
  };
}
