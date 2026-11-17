import { createHash } from 'node:crypto';

import {
  academicPeriods,
  admissionsOffers,
  offerConfirmationDecisions,
  studentApplications,
  workflowTasks,
  type Db,
  withTenantContext,
} from '@revelation-srs/db';
import { ConflictError, NotFoundError, ValidationError } from '@revelation-srs/domain';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';

import type { EnrolmentService } from '../enrolment/service.js';
import type { CasCaseService } from '../regulatory/cas-case-service.js';
import type { ReviewExecutionService } from '../platform-controls/review-execution-service.js';
import type { WorkflowBridgeService } from '../platform-controls/workflow-bridge-service.js';
import type { WorkflowTaskService } from '../platform-controls/workflow-runtime-service.js';

type Uuid = `${string}-${string}-${string}-${string}-${string}`;

const HANDOFF_STEP_KEY = 'handoff-to-srs-enrolment';
const FINISHED_TASK_STATUSES = ['completed', 'cancelled', 'failed'];

export interface ConversionBlocker { code: 'no-confirmed-offer' | 'identity-unresolved' | 'intake-unknown' | 'cas-not-assigned'; message: string }

export interface ConversionPreview {
  applicationId: string;
  personId: string | null;
  offerId: string | null;
  /** The enrolment this conversion creates, or created: the same every time. */
  enrolmentId: string | null;
  enrolmentExists: boolean;
  programmeId: string | null;
  programmeSource: 'offer' | 'alternative' | null;
  modeOfStudyCode: string | null;
  intakeCode: string | null;
  academicYearOfEntry: string | null;
  startDate: string | null;
  feeStatusBasisCode: string | null;
  /** From a UCAS (or UCAS-reconciled Clearing) application, so registration confirms to UCAS. */
  ucasPersonalId: string | null;
  handoffTaskId: string | null;
  handoffTaskStatus: string | null;
  blockers: ConversionBlocker[];
}

/** A stable enrolment ID for an offer, so converting twice returns the same enrolment (D-10). */
export function enrolmentIdForOffer(tenantId: string, offerId: string): string {
  const h = createHash('sha1').update(`srs:enrolment-from-offer:${tenantId}:${offerId}`).digest('hex');
  // Formatted as a version-5 (name-based) UUID.
  const variant = ((parseInt(h.slice(16, 18), 16) & 0x3f) | 0x80).toString(16).padStart(2, '0');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${variant}${h.slice(18, 20)}-${h.slice(20, 32)}`;
}

/** The academic year an intake month falls in: August onwards starts a new year. */
export function academicYearForIntake(intakeCode: string): string | null {
  const m = /^(\d{4})-(\d{2})$/.exec(intakeCode);
  if (!m) return null;
  const year = Number(m[1]);
  const start = Number(m[2]) >= 8 ? year : year - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

/**
 * Applicant conversion (BP-01-007, BP-02-001; D-10). Completing the
 * admissions hand-off creates the student's enrolment from the confirmed
 * offer, in pre-registration until they register. Values come from the offer
 * (or the alternative programme it was confirmed on) and the intake; the
 * registry can change only the start date.
 */
export class ApplicantConversionService {
  constructor(
    private readonly db: Db,
    private readonly enrolments: EnrolmentService,
    private readonly workflowBridge: WorkflowBridgeService,
    private readonly workflowTasks: WorkflowTaskService,
    private readonly reviewExecution?: ReviewExecutionService,
    private readonly casCases?: CasCaseService,
  ) {}

  async preview(tenantId: string, applicationId: string): Promise<ConversionPreview> {
    const t = tenantId as Uuid;
    const data = await withTenantContext(this.db, tenantId, async (tx) => {
      const [app] = await tx.select().from(studentApplications).where(and(eq(studentApplications.tenantId, t), eq(studentApplications.id, applicationId as Uuid))).limit(1);
      if (!app) return null;
      const offers = await tx.select().from(admissionsOffers).where(and(eq(admissionsOffers.applicationId, app.id), eq(admissionsOffers.statusCode, 'confirmed')))
        .orderBy(desc(admissionsOffers.decidedAt)).limit(1);
      const offer = offers[0] ?? null;
      const [decision] = offer ? await tx.select().from(offerConfirmationDecisions)
        .where(and(eq(offerConfirmationDecisions.offerId, offer.id), inArray(offerConfirmationDecisions.decisionCode, ['confirmed', 'confirmed-alternative'])))
        .orderBy(desc(offerConfirmationDecisions.decidedAt)).limit(1) : [];
      const [task] = decision?.handoffWorkflowInstanceId ? await tx.select({ id: workflowTasks.id, statusCode: workflowTasks.statusCode }).from(workflowTasks)
        .where(and(eq(workflowTasks.workflowInstanceId, decision.handoffWorkflowInstanceId), eq(workflowTasks.stepKey, HANDOFF_STEP_KEY)))
        .orderBy(desc(workflowTasks.createdAt)).limit(1) : [];
      return { app, offer, decision: decision ?? null, task: task ?? null };
    });
    if (!data) throw new NotFoundError('Application', applicationId);
    const { app, offer, decision, task } = data;

    const blockers: ConversionBlocker[] = [];
    if (!offer || !decision) blockers.push({ code: 'no-confirmed-offer', message: 'The application has no confirmed offer' });
    if (!app.personId || app.identityMatchCode === 'needs-review') {
      blockers.push({ code: 'identity-unresolved', message: 'The applicant\'s identity must be resolved to one person first' });
    }
    // CAS problems are caught before the enrolment exists (D-10, D-16).
    if (this.casCases && (await this.casCases.openCaseForApplication(tenantId, app.id))) {
      blockers.push({ code: 'cas-not-assigned', message: 'The applicant\'s CAS case is still open: record the CAS number (or withdraw the case) first' });
    }
    const alternative = decision?.decisionCode === 'confirmed-alternative' && decision.alternativeProgrammeId;
    const academicYearOfEntry = offer ? academicYearForIntake(offer.intakeCode) : null;
    if (offer && !academicYearOfEntry) blockers.push({ code: 'intake-unknown', message: `The intake '${offer.intakeCode}' is not a year and month (YYYY-MM)` });
    const enrolmentId = offer ? enrolmentIdForOffer(tenantId, offer.id) : null;

    return {
      applicationId: app.id,
      personId: app.personId,
      offerId: offer?.id ?? null,
      enrolmentId,
      enrolmentExists: enrolmentId ? Boolean(await this.enrolments.getEnrolment(enrolmentId, tenantId)) : false,
      programmeId: alternative ? decision.alternativeProgrammeId : (offer?.programmeId ?? null),
      programmeSource: offer ? (alternative ? 'alternative' : 'offer') : null,
      modeOfStudyCode: offer?.modeOfStudyCode ?? null,
      intakeCode: offer?.intakeCode ?? null,
      academicYearOfEntry,
      startDate: offer && academicYearOfEntry ? await this.#startDate(tenantId, offer.intakeCode, academicYearOfEntry) : null,
      feeStatusBasisCode: offer?.feeStatusBasisCode ?? null,
      ucasPersonalId: ['ucas', 'clearing'].includes(app.channelCode) ? (/^\d{4}:(\d{10})$/.exec(app.sourceReference)?.[1] ?? null) : null,
      handoffTaskId: task?.id ?? null,
      handoffTaskStatus: task?.statusCode ?? null,
      blockers,
    };
  }

  /** Creates the pre-registration enrolment (or returns the one already created) and completes the hand-off task. */
  async convert(tenantId: string, applicationId: string, input: { startDate?: string }, actorId: string): Promise<ConversionPreview> {
    const preview = await this.preview(tenantId, applicationId);
    if (preview.blockers.length > 0) throw new ConflictError(preview.blockers.map((b) => b.message).join('; '));
    const startDate = input.startDate ?? preview.startDate;
    if (!startDate) throw new ValidationError('Give the start date');

    if (!preview.enrolmentExists) {
      await this.enrolments.createEnrolment(tenantId, {
        personId: preview.personId!, modeOfStudyCode: preview.modeOfStudyCode!, academicYearOfEntry: preview.academicYearOfEntry!, startDate,
        ...(preview.programmeId ? { programmeId: preview.programmeId } : {}),
      ...(preview.ucasPersonalId ? { ucasPersonalId: preview.ucasPersonalId } : {}),
      }, actorId, { enrolmentId: preview.enrolmentId!, initialStatus: 'pre-registration' });
    }
    await this.casCases?.attachEnrolment(tenantId, applicationId, preview.enrolmentId!, actorId);
    if (preview.handoffTaskId && preview.handoffTaskStatus && !FINISHED_TASK_STATUSES.includes(preview.handoffTaskStatus)) {
      await this.#completeHandoff(tenantId, preview.handoffTaskId, preview.enrolmentId!, actorId);
    }
    return this.preview(tenantId, applicationId);
  }

  async #completeHandoff(tenantId: string, workflowTaskId: string, enrolmentId: string, actorId: string): Promise<void> {
    const task = await this.workflowTasks.getTask(workflowTaskId, tenantId);
    const payload = { enrolmentId, note: 'Enrolment created from the confirmed offer' };
    if (task.executionBackend === 'temporal' && this.reviewExecution) {
      const receipt = await this.reviewExecution.submitCommand({
        tenantId, workflowTaskId, actorId, commandType: 'decision',
        decisionCode: task.outcomeOptions?.[0]?.code ?? 'mark-complete', payload, idempotencyKey: `handoff-conversion:${workflowTaskId}`,
      });
      if (receipt.status === 'failed' || receipt.status === 'superseded') {
        throw new ConflictError(receipt.errorDetail ?? 'The enrolment was created but the hand-off task could not be completed; complete it from the Task Inbox');
      }
      return;
    }
    await this.workflowBridge.completeWorkflowTask({ tenantId, workflowTaskId, completedBy: actorId, payload });
    await this.workflowBridge.completeWorkflowInstance({ tenantId, workflowInstanceId: task.workflowInstanceId, statusCode: 'completed', actorId, metadata: { enrolmentId } });
  }

  /** The start of the teaching period that opens in the intake month, or the first of that month. */
  async #startDate(tenantId: string, intakeCode: string, academicYear: string): Promise<string> {
    const periods = await withTenantContext(this.db, tenantId, (tx) => tx.select({ startDate: academicPeriods.startDate, type: academicPeriods.periodTypeCode })
      .from(academicPeriods).where(and(eq(academicPeriods.tenantId, tenantId as Uuid), eq(academicPeriods.academicYear, academicYear)))
      .orderBy(asc(academicPeriods.startDate)));
    const inMonth = periods.filter((p) => p.startDate.startsWith(intakeCode) && p.type !== 'reassessment');
    return inMonth[0]?.startDate ?? `${intakeCode}-01`;
  }
}
