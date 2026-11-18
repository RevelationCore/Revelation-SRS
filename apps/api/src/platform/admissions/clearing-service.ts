import {
  admissionsOffers,
  businessCases,
  caseDecisions,
  caseEvidenceReferences,
  studentApplications,
  tenants,
  type Db,
  withTenantContext,
} from '@revelation-srs/db';
import { ConflictError, NotFoundError, ValidationError } from '@revelation-srs/domain';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';

import type { BusinessCaseService } from '../cases/business-case-service.js';
import { clockNow } from '../clock.js';
import { addWorkingDaysFor } from '../calendar/working-days.js';

import type { ApplicationDto, ApplicationService, ReceiveApplicationInput } from './application-service.js';

type Uuid = `${string}-${string}-${string}-${string}-${string}`;

export const CLEARING_PROCESS_ID = 'BP-01-006';
const OFFER_LINK = 'clearing-offer';

export interface ClearingSettings {
  opensAt: string | null;
  closesAt: string | null;
  programmeIds: string[];
  verbalOfferHours: number;
}
export interface ClearingStatus extends ClearingSettings { open: boolean }

/** Why the fast path cannot be used: the applicant must go through the ordinary route (D-13). */
export interface ClearingDeclarations {
  safeguardingConcern: boolean;
  convictionDeclared: boolean;
  fitnessToPractiseRequired: boolean;
  studentVisaRequired: boolean;
}

export interface ClearingCallInput {
  callReference: string;
  reason: string;
  cycle: string;
  ucasPersonalId?: string;
  applicant: ReceiveApplicationInput['applicant'];
  programmeId: string;
  intakeCode: string;
  modeOfStudyCode: string;
  declarations: ClearingDeclarations;
  offer: { offerTypeCode: 'clearing-verbal' | 'conditional' | 'unconditional'; feeStatusBasisCode?: string; conditions?: Array<{ conditionTypeCode: string; description: string; requiredValue?: string }> };
}

export interface ClearingReviewDto {
  caseId: string;
  statusCode: string;
  applicationId: string;
  sourceReference: string;
  offerId: string;
  offerTypeCode: string;
  expiresOn: string | null;
  programmeId: string;
  decidedBy: string;
  decidedAt: Date;
  reviewDueBy: Date;
  review: { outcomeCode: string; reviewedBy: string; reviewedAt: Date; note: string | null } | null;
}

const DECLARATION_LABELS: Record<keyof ClearingDeclarations, string> = {
  safeguardingConcern: 'a safeguarding concern',
  convictionDeclared: 'a declared conviction',
  fitnessToPractiseRequired: 'a fitness-to-practise check',
  studentVisaRequired: 'a Student visa (CAS)',
};

/**
 * Clearing (BP-01-006; D-13). While the Clearing window is open, and for
 * programmes listed as open in Clearing, a holder of clearing:decide takes a
 * call to an offer in one audited step. Each such decision is reviewed by a
 * different programme approver by the next working day.
 */
export class ClearingService {
  constructor(
    private readonly db: Db,
    private readonly applications: ApplicationService,
    private readonly businessCases: BusinessCaseService,
  ) {}

  async status(tenantId: string): Promise<ClearingStatus> {
    const settings = await this.#settings(tenantId);
    const now = clockNow();
    const open = Boolean(settings.opensAt && settings.closesAt && new Date(settings.opensAt) <= now && now < new Date(settings.closesAt));
    return { ...settings, open };
  }

  async takeCall(tenantId: string, input: ClearingCallInput, actorId: string): Promise<{ application: ApplicationDto; reviewCaseId: string }> {
    if (!input.callReference.trim()) throw new ValidationError('Record the call reference');
    if (!input.reason.trim()) throw new ValidationError('Record the reason for the decision');
    const status = await this.status(tenantId);
    if (!status.open) throw new ConflictError('The Clearing window is not open');
    if (!status.programmeIds.includes(input.programmeId)) throw new ConflictError('This programme is not open in Clearing');
    const raised = (Object.keys(DECLARATION_LABELS) as Array<keyof ClearingDeclarations>).filter((k) => input.declarations[k]);
    if (raised.length > 0) {
      throw new ConflictError(`The applicant needs ${raised.map((k) => DECLARATION_LABELS[k]).join(' and ')}: use the standard admissions route, not the Clearing fast path`);
    }

    const { application } = await this.applications.receive(tenantId, {
      channelCode: 'clearing',
      // With a UCAS personal ID, the same reference the UCAS feed uses, so its Clearing choice reconciles with this call.
      sourceReference: input.ucasPersonalId ? `${input.cycle}:${input.ucasPersonalId}` : `call:${input.callReference.trim()}`,
      cycle: input.cycle, programmeId: input.programmeId, intakeCode: input.intakeCode, modeOfStudyCode: input.modeOfStudyCode,
      applicant: input.applicant,
      payload: { callReference: input.callReference.trim(), declarations: input.declarations, ...(input.ucasPersonalId ? { ucasPersonalId: input.ucasPersonalId } : {}) },
    }, actorId);
    if (!application.personId) {
      throw new ConflictError('The applicant may already have a record: confirm their identity on the application page, then take the call again');
    }

    const expiresOn = input.offer.offerTypeCode === 'clearing-verbal'
      ? new Date(clockNow().getTime() + status.verbalOfferHours * 3_600_000).toISOString().slice(0, 10)
      : undefined;
    const { application: decided, offerId } = await this.applications.clearingFastPath(tenantId, application.id, {
      callReference: input.callReference.trim(), reason: input.reason.trim(),
      offer: { ...input.offer, ...(expiresOn ? { expiresOn } : {}) },
    }, actorId);

    const reviewCaseId = await this.businessCases.openCase(tenantId, {
      subjectType: 'student_application', subjectId: application.id, processId: CLEARING_PROCESS_ID, statusCode: 'open', ownerId: actorId,
    }, actorId);
    await this.businessCases.addEvidence(reviewCaseId, tenantId, {
      evidenceRef: `admissions_offer:${offerId}`, classificationCode: 'operational', sourceSystem: 'srs', sourceReference: OFFER_LINK, receivedBy: actorId,
    });
    return { application: decided, reviewCaseId };
  }

  async listReviews(tenantId: string, opts: { pending?: boolean } = {}): Promise<ClearingReviewDto[]> {
    const t = tenantId as Uuid;
    const data = await withTenantContext(this.db, tenantId, async (tx) => {
      const cases = await tx.select().from(businessCases).where(and(
        eq(businessCases.tenantId, t), eq(businessCases.processId, CLEARING_PROCESS_ID), isNull(businessCases.recordedUntil),
        ...(opts.pending ? [eq(businessCases.statusCode, 'open')] : []),
      )).orderBy(asc(businessCases.validFrom));
      const ids = cases.map((c) => c.id);
      if (ids.length === 0) return { cases, links: [], decisions: [], offers: [], apps: [] };
      const links = await tx.select().from(caseEvidenceReferences).where(and(inArray(caseEvidenceReferences.businessCaseId, ids), eq(caseEvidenceReferences.sourceReference, OFFER_LINK)));
      const decisions = await tx.select().from(caseDecisions).where(inArray(caseDecisions.businessCaseId, ids));
      const offerIds = links.map((l) => l.evidenceRef.slice('admissions_offer:'.length) as Uuid);
      const offers = offerIds.length ? await tx.select().from(admissionsOffers).where(inArray(admissionsOffers.id, offerIds)) : [];
      const apps = await tx.select({ id: studentApplications.id, sourceReference: studentApplications.sourceReference }).from(studentApplications)
        .where(inArray(studentApplications.id, cases.map((c) => c.subjectId)));
      return { cases, links, decisions, offers, apps };
    });
    const out: ClearingReviewDto[] = [];
    for (const c of data.cases) {
      const link = data.links.find((l) => l.businessCaseId === c.id);
      const offer = link && data.offers.find((o) => `admissions_offer:${o.id}` === link.evidenceRef);
      if (!offer) continue;
      const decision = data.decisions.find((d) => d.businessCaseId === c.id);
      out.push({
        caseId: c.id, statusCode: c.statusCode, applicationId: c.subjectId,
        sourceReference: data.apps.find((a) => a.id === c.subjectId)?.sourceReference ?? '',
        offerId: offer.id, offerTypeCode: offer.offerTypeCode, expiresOn: offer.expiresOn, programmeId: offer.programmeId,
        decidedBy: offer.decidedBy, decidedAt: offer.decidedAt, reviewDueBy: await addWorkingDaysFor(this.db, tenantId, offer.decidedAt, 1),
        review: decision ? { outcomeCode: decision.decisionTypeCode, reviewedBy: decision.authorityActorId, reviewedAt: decision.decidedAt, note: decision.reasonText } : null,
      });
    }
    return out;
  }

  /** The next-day review by a different programme approver. A correction is then made by changing the offer, with a reason. */
  async review(tenantId: string, caseId: string, input: { outcomeCode: 'upheld' | 'correction-needed'; note?: string }, actorId: string): Promise<ClearingReviewDto> {
    const [item] = (await this.listReviews(tenantId)).filter((r) => r.caseId === caseId);
    if (!item) throw new NotFoundError('Clearing review', caseId);
    if (item.statusCode !== 'open') throw new ConflictError('This Clearing decision has already been reviewed');
    if (item.decidedBy === actorId) throw new ConflictError('The person who made a Clearing decision cannot review it');
    if (input.outcomeCode === 'correction-needed' && !input.note?.trim()) throw new ValidationError('Say what needs correcting');
    await this.businessCases.recordDecision(caseId, tenantId, {
      decisionTypeCode: input.outcomeCode, authorityActorId: actorId, ...(input.note?.trim() ? { reasonText: input.note.trim() } : {}), effectiveAt: clockNow(),
    });
    await this.businessCases.advanceCaseStatus(caseId, tenantId, 'decided', actorId);
    const [updated] = (await this.listReviews(tenantId)).filter((r) => r.caseId === caseId);
    return updated!;
  }

  async #settings(tenantId: string): Promise<ClearingSettings> {
    const [row] = await this.db.select({ configuration: tenants.configuration }).from(tenants).where(eq(tenants.id, tenantId as Uuid)).limit(1);
    const c = (row?.configuration?.['clearing'] ?? {}) as Record<string, unknown>;
    const str = (v: unknown) => (typeof v === 'string' && v ? v : null);
    const hours = c['verbalOfferHours'];
    return {
      opensAt: str(c['opensAt']), closesAt: str(c['closesAt']),
      programmeIds: Array.isArray(c['programmeIds']) ? c['programmeIds'].filter((p): p is string => typeof p === 'string') : [],
      verbalOfferHours: typeof hours === 'number' && hours > 0 ? hours : 48,
    };
  }
}
