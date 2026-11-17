import { createHash } from 'node:crypto';

import {
  admissionsOffers,
  applicationAssessments,
  applicationReceivedPayloads,
  conditionEvidence,
  offerConditions,
  offerConfirmationDecisions,
  personIdentities,
  persons,
  programmes,
  studentApplications,
  type AdmissionsOffer,
  type ApplicationAssessment,
  type ConditionEvidence,
  type Db,
  type OfferCondition,
  type OfferConfirmationDecision,
  type StudentApplication,
  withTenantContext,
} from '@revelation-srs/db';
import { ConflictError, NotFoundError, ValidationError } from '@revelation-srs/domain';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';

import { clockNow } from '../clock.js';
import type { StudentService } from '../students/service.js';
import type { UcasDecisionOutbox, UcasOutcome } from '../regulatory/ucas-decision-outbox.js';
import type { ValueSetService } from '../value-sets/service.js';

import type { AdmissionSourceCode, AdmissionsService } from './admissions-service.js';

type Uuid = `${string}-${string}-${string}-${string}-${string}`;

export interface ReceiveApplicationInput {
  channelCode: AdmissionSourceCode;
  sourceReference: string;
  cycle: string;
  /** A channel adapter may send an application before these are known; it is then received as incomplete. */
  programmeId?: string | null;
  intakeCode?: string | null;
  modeOfStudyCode?: string | null;
  /** The UCAS channel's own record, for an application received through the UCAS adapter. */
  ucasApplicationId?: string;
  applicant: { personId?: string; studentNumber?: string; legalFirstName: string; legalFamilyName: string; dateOfBirth?: string; emailPersonal?: string };
  payload: Record<string, unknown>;
}

export interface OfferTerms {
  offerTypeCode: 'conditional' | 'unconditional';
  feeStatusBasisCode?: string;
  expiresOn?: string;
  conditions?: Array<{ conditionTypeCode: string; description: string; requiredValue?: string; matchCriteria?: ConditionMatchCriteria }>;
}

/** Structured criteria a UCAS result is matched against (D-15). Without them a result is only suggested for review. */
export interface ConditionMatchCriteria { qualificationTypeCode: string; subject?: string; minimumGrade: string; gradeScale: string }

export interface ApplicationDto extends StudentApplication {
  assessments: ApplicationAssessment[];
  offers: Array<AdmissionsOffer & { conditions: Array<OfferCondition & { evidence: ConditionEvidence[] }>; confirmation: OfferConfirmationDecision | null }>;
}

/**
 * Applications and offers (BPR-D01, BPR-D02; BP-01-001 to BP-01-004). The
 * received payload is kept as received; the applicant is matched only on
 * certain evidence; the person who recommends does not decide; and the
 * confirmation decision freezes the condition versions it tested, then
 * hands the confirmed applicant to enrolment.
 */
export class ApplicationService {
  constructor(
    private readonly db: Db,
    private readonly valueSets: ValueSetService,
    private readonly students: StudentService,
    private readonly admissions: AdmissionsService,
  ) {}

  #ucasOutbox: UcasDecisionOutbox | null = null;

  /** Decisions on UCAS-channel applications are queued for UCAS in the same transaction (D-15). */
  useUcasOutbox(outbox: UcasDecisionOutbox): void {
    this.#ucasOutbox = outbox;
  }

  /** The outbox registration, when this application's decisions go to UCAS. */
  async #ucasRegistration(tenantId: string, app: StudentApplication, actorId: string): Promise<string | null> {
    return app.ucasApplicationId && this.#ucasOutbox ? this.#ucasOutbox.registration(tenantId, actorId) : null;
  }

  async #queueForUcas(tx: Parameters<Parameters<typeof withTenantContext>[2]>[0], tenantId: string, registrationId: string | null, app: StudentApplication, outcome: UcasOutcome, idempotencyKey: string, detail: Record<string, unknown>): Promise<void> {
    if (!registrationId || !this.#ucasOutbox || !app.ucasApplicationId) return;
    await this.#ucasOutbox.queue(tx, tenantId, registrationId, {
      applicationId: app.id, ucasApplicationId: app.ucasApplicationId, sourceReference: app.sourceReference, cycle: app.cycle, outcome, idempotencyKey, detail,
    });
  }

  // ── Receive and route (BP-01-001) ──────────────────────────────────────────

  /**
   * Receives an application from a channel. A direct call must name a known
   * programme, intake and mode of study; a channel adapter (`lenient`) may
   * not know them yet, and the application is then kept on the incomplete
   * worklist instead of being refused.
   */
  async receive(
    tenantId: string, input: ReceiveApplicationInput, actorId: string, options: { lenient?: boolean } = {},
  ): Promise<{ application: ApplicationDto; created: boolean }> {
    await this.#code(tenantId, 'student_application', 'channel_code', input.channelCode);
    const route = await this.#routeFacts(tenantId, input, options.lenient ?? false);

    const payloadHash = createHash('sha256').update(JSON.stringify(input.payload)).digest('hex');
    const payloadId = await withTenantContext(this.db, tenantId, async (tx) => {
      await tx.insert(applicationReceivedPayloads).values({
        tenantId: tenantId as Uuid, channelCode: input.channelCode, sourceReference: input.sourceReference, cycle: input.cycle,
        payload: input.payload, payloadHash, receivedBy: actorId,
      }).onConflictDoNothing();
      const [row] = await tx.select({ id: applicationReceivedPayloads.id }).from(applicationReceivedPayloads).where(and(
        eq(applicationReceivedPayloads.tenantId, tenantId as Uuid), eq(applicationReceivedPayloads.channelCode, input.channelCode),
        eq(applicationReceivedPayloads.sourceReference, input.sourceReference), eq(applicationReceivedPayloads.payloadHash, payloadHash),
      )).limit(1);
      return row!.id;
    });

    // A UCAS Clearing choice reconciles with the Clearing call already taken for the same UCAS applicant (D-13).
    const existing = await this.#bySource(tenantId, input.channelCode, input.sourceReference)
      ?? (input.channelCode === 'ucas' ? await this.#bySource(tenantId, 'clearing', input.sourceReference) : null);
    if (existing) {
      // A resend or update from the channel: keep the application, point at the latest payload.
      // An incomplete application whose route facts have now arrived returns to the received worklist.
      const completes = existing.statusCode === 'incomplete' && existing.routingReasonCode === 'incomplete' && route.complete;
      await withTenantContext(this.db, tenantId, (tx) => tx.update(studentApplications).set({
        latestPayloadId: payloadId, updatedAt: clockNow(),
        ...(input.ucasApplicationId && !existing.ucasApplicationId ? { ucasApplicationId: input.ucasApplicationId } : {}),
        ...(completes ? {
          programmeId: route.programmeId, intakeCode: route.intakeCode, modeOfStudyCode: route.modeOfStudyCode,
          statusCode: 'received', routingReasonCode: existing.identityMatchCode === 'needs-review' ? 'identity' : null,
        } : {}),
      }).where(eq(studentApplications.id, existing.id)));
      return { application: await this.get(tenantId, existing.id), created: false };
    }

    const identity = await this.#matchApplicant(tenantId, input);
    const [row] = await withTenantContext(this.db, tenantId, (tx) => tx.insert(studentApplications).values({
      tenantId: tenantId as Uuid, channelCode: input.channelCode, sourceReference: input.sourceReference, cycle: input.cycle,
      personId: (identity.personId ?? null) as Uuid | null, identityMatchCode: identity.matchCode,
      programmeId: route.programmeId as Uuid | null, intakeCode: route.intakeCode, modeOfStudyCode: route.modeOfStudyCode,
      ucasApplicationId: (input.ucasApplicationId ?? null) as Uuid | null, latestPayloadId: payloadId as Uuid,
      statusCode: route.complete ? 'received' : 'incomplete',
      routingReasonCode: !route.complete ? 'incomplete' : identity.matchCode === 'needs-review' ? 'identity' : null,
    }).returning());
    return { application: await this.get(tenantId, row!.id), created: true };
  }

  /** Confirms the applicant identity after review (never an automatic merge). */
  async resolveIdentity(tenantId: string, applicationId: string, personId: string): Promise<ApplicationDto> {
    const app = await this.#app(tenantId, applicationId);
    const found = await withTenantContext(this.db, tenantId, (tx) => tx.select({ id: persons.id }).from(persons)
      .where(and(eq(persons.id, personId as Uuid), eq(persons.tenantId, tenantId as Uuid))).limit(1));
    if (!found[0]) throw new NotFoundError('Person', personId);
    await withTenantContext(this.db, tenantId, (tx) => tx.update(studentApplications).set({
      personId: personId, identityMatchCode: 'matched',
      routingReasonCode: app.routingReasonCode === 'identity' ? null : app.routingReasonCode, updatedAt: clockNow(),
    }).where(eq(studentApplications.id, app.id)));
    return this.get(tenantId, applicationId);
  }

  async route(tenantId: string, applicationId: string, reasonCode: 'incomplete' | 'duplicate' | 'restricted' | null): Promise<ApplicationDto> {
    const app = await this.#app(tenantId, applicationId);
    if (reasonCode !== 'incomplete' && app.statusCode === 'incomplete' && (!app.programmeId || !app.intakeCode || !app.modeOfStudyCode)) {
      throw new ConflictError('The application has no programme, intake or mode of study yet; it stays incomplete until the channel sends them');
    }
    await withTenantContext(this.db, tenantId, (tx) => tx.update(studentApplications).set({
      routingReasonCode: reasonCode, statusCode: reasonCode === 'incomplete' ? 'incomplete' : app.statusCode === 'incomplete' ? 'received' : app.statusCode,
      updatedAt: clockNow(),
    }).where(eq(studentApplications.id, app.id)));
    return this.get(tenantId, applicationId);
  }

  // ── Assess and recommend (BP-01-002) ───────────────────────────────────────

  async assess(tenantId: string, applicationId: string, input: { assessmentTypeCode: string; outcomeCode: string; evidenceRef?: string; evidenceVersion?: string; note?: string }, actorId: string): Promise<ApplicationDto> {
    const app = await this.#app(tenantId, applicationId);
    if (!app.personId) throw new ConflictError('Confirm the applicant identity before assessing the application');
    if (!['received', 'under-assessment'].includes(app.statusCode)) throw new ConflictError(`An application that is ${app.statusCode} cannot be assessed`);
    await this.#code(tenantId, 'application_assessment', 'assessment_type_code', input.assessmentTypeCode);
    await this.#code(tenantId, 'application_assessment', 'outcome_code', input.outcomeCode);
    await withTenantContext(this.db, tenantId, async (tx) => {
      await tx.insert(applicationAssessments).values({
        tenantId: tenantId as Uuid, applicationId: app.id, assessmentTypeCode: input.assessmentTypeCode, outcomeCode: input.outcomeCode,
        evidenceRef: input.evidenceRef ?? null, evidenceVersion: input.evidenceVersion ?? null, note: input.note ?? null, assessedBy: actorId,
      });
      await tx.update(studentApplications).set({ statusCode: 'under-assessment', updatedAt: clockNow() }).where(eq(studentApplications.id, app.id));
    });
    return this.get(tenantId, applicationId);
  }

  async recommend(tenantId: string, applicationId: string, input: { recommendationCode: 'offer' | 'reject'; reason: string }, actorId: string): Promise<ApplicationDto> {
    const app = await this.#app(tenantId, applicationId);
    if (app.statusCode !== 'under-assessment') throw new ConflictError('An application is recommended after it has been assessed');
    const assessments = await this.#assessments(tenantId, app.id);
    if (input.recommendationCode === 'offer' && assessments.some((a) => a.assessmentTypeCode === 'safeguarding' && a.outcomeCode === 'concern')) {
      throw new ConflictError('An outstanding safeguarding or compliance concern must be resolved before an offer is recommended (BP-01-002 step 5)');
    }
    await withTenantContext(this.db, tenantId, (tx) => tx.update(studentApplications).set({
      statusCode: 'recommended', recommendationCode: input.recommendationCode, recommendationReason: input.reason,
      recommendedBy: actorId, recommendedAt: clockNow(), updatedAt: clockNow(),
    }).where(eq(studentApplications.id, app.id)));
    return this.get(tenantId, applicationId);
  }

  // ── Decide and manage the offer (BP-01-003) ────────────────────────────────

  async decide(tenantId: string, applicationId: string, input: { decisionCode: 'offer' | 'reject'; reason?: string; offer?: OfferTerms }, actorId: string): Promise<ApplicationDto> {
    const app = await this.#app(tenantId, applicationId);
    if (app.statusCode !== 'recommended') throw new ConflictError('An application is decided after a recommendation');
    if (app.recommendedBy === actorId) throw new ConflictError('The person who recommended an application cannot decide it');

    const ucasRegistration = await this.#ucasRegistration(tenantId, app, actorId);
    if (input.decisionCode === 'reject') {
      await withTenantContext(this.db, tenantId, async (tx) => {
        await tx.update(studentApplications).set({ statusCode: 'rejected', updatedAt: clockNow() }).where(eq(studentApplications.id, app.id));
        await this.#queueForUcas(tx, tenantId, ucasRegistration, app, 'reject', `ucas-reject:${app.id}`, { reason: input.reason ?? null });
      });
      return this.get(tenantId, applicationId);
    }
    if (!input.offer) throw new ValidationError('An offer decision needs the offer terms');
    if (!app.programmeId || !app.intakeCode || !app.modeOfStudyCode) throw new ConflictError('An offer needs the application programme, intake and mode of study');
    const route = { programmeId: app.programmeId, intakeCode: app.intakeCode, modeOfStudyCode: app.modeOfStudyCode };
    await this.#validateTerms(tenantId, input.offer);
    await withTenantContext(this.db, tenantId, async (tx) => {
      const [offer] = await tx.insert(admissionsOffers).values({
        tenantId: tenantId as Uuid, applicationId: app.id, version: 1, programmeId: route.programmeId, intakeCode: route.intakeCode,
        modeOfStudyCode: route.modeOfStudyCode, feeStatusBasisCode: input.offer!.feeStatusBasisCode ?? null,
        offerTypeCode: input.offer!.offerTypeCode, expiresOn: input.offer!.expiresOn ?? null, decidedBy: actorId,
      }).returning();
      await this.#insertConditions(tx, tenantId, offer!.id, input.offer!.conditions ?? []);
      await tx.update(studentApplications).set({ statusCode: 'offered', updatedAt: clockNow() }).where(eq(studentApplications.id, app.id));
      await this.#queueForUcas(tx, tenantId, ucasRegistration, app, input.offer!.offerTypeCode === 'conditional' ? 'offer-conditional' : 'offer-unconditional',
        `ucas-decision:${offer!.id}`, { offerId: offer!.id, version: 1, conditions: (input.offer!.conditions ?? []).map((c) => c.description) });
    });
    return this.get(tenantId, applicationId);
  }

  /**
   * The Clearing fast path (BP-01-006; D-13): assessment, recommendation and
   * offer in one audited step by one person, which the ordinary route keeps
   * apart. The caller has checked the window, programme and declarations;
   * a later review by someone else stands in for the separation of duties.
   */
  async clearingFastPath(tenantId: string, applicationId: string, input: {
    callReference: string; reason: string; offer: { offerTypeCode: 'clearing-verbal' | 'conditional' | 'unconditional'; expiresOn?: string; feeStatusBasisCode?: string; conditions?: OfferTerms['conditions'] };
  }, actorId: string): Promise<{ application: ApplicationDto; offerId: string }> {
    const app = await this.#app(tenantId, applicationId);
    if (!app.personId) throw new ConflictError('Confirm the applicant identity before deciding');
    if (!['received', 'under-assessment'].includes(app.statusCode)) throw new ConflictError(`An application that is ${app.statusCode} cannot be decided through Clearing`);
    if (!app.programmeId || !app.intakeCode || !app.modeOfStudyCode) throw new ConflictError('A Clearing offer needs the programme, intake and mode of study');
    if (input.offer.offerTypeCode === 'clearing-verbal') {
      if ((input.offer.conditions ?? []).length > 0) throw new ValidationError('A verbal Clearing offer has no conditions');
      if (!input.offer.expiresOn) throw new ValidationError('A verbal Clearing offer expires');
    } else {
      await this.#validateTerms(tenantId, { offerTypeCode: input.offer.offerTypeCode, conditions: input.offer.conditions ?? [], ...(input.offer.feeStatusBasisCode ? { feeStatusBasisCode: input.offer.feeStatusBasisCode } : {}) });
    }
    const now = clockNow();
    const clearingRegistration = await this.#ucasRegistration(tenantId, app, actorId);
    const offerId = await withTenantContext(this.db, tenantId, async (tx) => {
      await tx.insert(applicationAssessments).values({
        tenantId: tenantId as Uuid, applicationId: app.id, assessmentTypeCode: 'academic', outcomeCode: 'meets',
        evidenceRef: `clearing-call:${input.callReference}`, evidenceVersion: null, note: input.reason, assessedBy: actorId,
      });
      const [offer] = await tx.insert(admissionsOffers).values({
        tenantId: tenantId as Uuid, applicationId: app.id, version: 1, programmeId: app.programmeId!, intakeCode: app.intakeCode!,
        modeOfStudyCode: app.modeOfStudyCode!, feeStatusBasisCode: input.offer.feeStatusBasisCode ?? null,
        offerTypeCode: input.offer.offerTypeCode, expiresOn: input.offer.expiresOn ?? null, decidedBy: actorId,
      }).returning();
      await this.#insertConditions(tx, tenantId, offer!.id, input.offer.conditions ?? []);
      await tx.update(studentApplications).set({
        statusCode: 'offered', recommendationCode: 'offer', recommendationReason: input.reason, recommendedBy: actorId, recommendedAt: now, updatedAt: now,
      }).where(eq(studentApplications.id, app.id));
      await this.#queueForUcas(tx, tenantId, clearingRegistration, app, input.offer.offerTypeCode === 'conditional' ? 'offer-conditional' : 'offer-unconditional',
        `ucas-decision:${offer!.id}`, { offerId: offer!.id, clearing: true });
      return offer!.id;
    });
    return { application: await this.get(tenantId, applicationId), offerId };
  }

  /** The applicant's response, with the channel's own timestamp. A response after expiry is refused. */
  async respond(tenantId: string, offerId: string, input: { responseCode: 'accept' | 'decline'; sourceTimestamp: string }): Promise<AdmissionsOffer> {
    const offer = await this.#offer(tenantId, offerId);
    if (offer.statusCode !== 'made') throw new ConflictError(`This offer is ${offer.statusCode}`);
    const sourceAt = new Date(input.sourceTimestamp);
    if (offer.expiresOn && sourceAt.toISOString().slice(0, 10) > offer.expiresOn) {
      await withTenantContext(this.db, tenantId, (tx) => tx.update(admissionsOffers).set({ statusCode: 'expired' }).where(eq(admissionsOffers.id, offer.id)));
      throw new ConflictError(`The offer expired on ${offer.expiresOn}`);
    }
    const [row] = await withTenantContext(this.db, tenantId, (tx) => tx.update(admissionsOffers).set({
      statusCode: input.responseCode === 'accept' ? 'accepted' : 'declined', responseCode: input.responseCode,
      responseSourceAt: sourceAt, respondedAt: clockNow(),
    }).where(eq(admissionsOffers.id, offer.id)).returning());
    return row!;
  }

  /** An authorised change: a new offer version supersedes the old one; conditions carry over unless replaced. */
  async changeOffer(tenantId: string, offerId: string, input: Partial<OfferTerms> & { reason: string; programmeId?: string; modeOfStudyCode?: string }, actorId: string): Promise<AdmissionsOffer> {
    const offer = await this.#offer(tenantId, offerId);
    if (!['made', 'accepted'].includes(offer.statusCode)) throw new ConflictError(`An offer that is ${offer.statusCode} cannot be changed`);
    if (input.programmeId) await this.#requireProgramme(tenantId, input.programmeId);
    if (input.modeOfStudyCode) await this.#code(tenantId, 'enrolment', 'mode_of_study_code', input.modeOfStudyCode);
    const priorConditions = await withTenantContext(this.db, tenantId, (tx) => tx.select().from(offerConditions).where(eq(offerConditions.offerId, offer.id)));
    const conditions: NonNullable<OfferTerms['conditions']> = input.conditions ?? priorConditions.map((c) => ({
      conditionTypeCode: c.conditionTypeCode, description: c.description, ...(c.requiredValue ? { requiredValue: c.requiredValue } : {}),
      ...(c.matchCriteria ? { matchCriteria: c.matchCriteria } : {}),
    }));
    const terms: OfferTerms = { offerTypeCode: input.offerTypeCode ?? (offer.offerTypeCode as OfferTerms['offerTypeCode']), conditions };
    await this.#validateTerms(tenantId, terms);
    const changeApp = await this.#app(tenantId, offer.applicationId);
    const changeRegistration = await this.#ucasRegistration(tenantId, changeApp, actorId);
    const newId = await withTenantContext(this.db, tenantId, async (tx) => {
      await tx.update(admissionsOffers).set({ statusCode: 'superseded' }).where(eq(admissionsOffers.id, offer.id));
      const [created] = await tx.insert(admissionsOffers).values({
        tenantId: tenantId as Uuid, applicationId: offer.applicationId, version: offer.version + 1, previousOfferId: offer.id,
        programmeId: (input.programmeId ?? offer.programmeId) as Uuid, intakeCode: offer.intakeCode,
        modeOfStudyCode: input.modeOfStudyCode ?? offer.modeOfStudyCode, feeStatusBasisCode: input.feeStatusBasisCode ?? offer.feeStatusBasisCode,
        offerTypeCode: terms.offerTypeCode, expiresOn: input.expiresOn ?? offer.expiresOn,
        // An accepted offer stays accepted through an authorised change.
        statusCode: offer.statusCode, responseCode: offer.responseCode, responseSourceAt: offer.responseSourceAt, respondedAt: offer.respondedAt,
        decidedBy: actorId, changeReason: input.reason,
      }).returning();
      await this.#insertConditions(tx, tenantId, created!.id, conditions);
      await this.#queueForUcas(tx, tenantId, changeRegistration, changeApp, terms.offerTypeCode === 'conditional' ? 'offer-conditional' : 'offer-unconditional',
        `ucas-decision:${created!.id}`, { offerId: created!.id, version: offer.version + 1, conditions: conditions.map((c) => c.description), changeReason: input.reason });
      return created!.id;
    });
    return this.#offer(tenantId, newId);
  }

  async withdrawOffer(tenantId: string, offerId: string): Promise<AdmissionsOffer> {
    const offer = await this.#offer(tenantId, offerId);
    if (!['made', 'accepted'].includes(offer.statusCode)) throw new ConflictError(`An offer that is ${offer.statusCode} cannot be withdrawn`);
    const app = await this.#app(tenantId, offer.applicationId);
    const registration = await this.#ucasRegistration(tenantId, app, 'system');
    const row = await withTenantContext(this.db, tenantId, async (tx) => {
      const [updated] = await tx.update(admissionsOffers).set({ statusCode: 'withdrawn' }).where(eq(admissionsOffers.id, offer.id)).returning();
      await this.#queueForUcas(tx, tenantId, registration, app, 'withdraw', `ucas-withdraw:${offer.id}`, { offerId: offer.id });
      return updated;
    });
    return row!;
  }

  // ── Conditions and confirmation (BP-01-004) ────────────────────────────────

  async recordEvidence(tenantId: string, conditionId: string, input: { provenanceCode: string; evidenceRef: string; reportedValue?: string; verified?: boolean }, actorId: string): Promise<ConditionEvidence> {
    const condition = await this.#condition(tenantId, conditionId);
    await this.#code(tenantId, 'condition_evidence', 'provenance_code', input.provenanceCode);
    const [row] = await withTenantContext(this.db, tenantId, (tx) => tx.insert(conditionEvidence).values({
      tenantId: tenantId as Uuid, conditionId: condition.id, provenanceCode: input.provenanceCode, evidenceRef: input.evidenceRef,
      reportedValue: input.reportedValue ?? null, verified: input.verified ?? false, receivedBy: actorId,
    }).returning());
    return row!;
  }

  async decideCondition(tenantId: string, conditionId: string, input: { statusCode: 'met' | 'waived' | 'unmet'; note?: string }, actorId: string): Promise<OfferCondition> {
    const condition = await this.#condition(tenantId, conditionId);
    const offer = await this.#offer(tenantId, condition.offerId);
    if (!['made', 'accepted'].includes(offer.statusCode)) throw new ConflictError(`Conditions on an offer that is ${offer.statusCode} are frozen`);
    if (input.statusCode === 'waived' && !input.note) throw new ValidationError('Waiving a condition needs the authority and reason');
    if (input.statusCode === 'met') {
      const evidence = await withTenantContext(this.db, tenantId, (tx) => tx.select().from(conditionEvidence).where(eq(conditionEvidence.conditionId, condition.id)));
      if (!evidence.some((e) => e.verified)) throw new ConflictError('A condition is met only on verified evidence (BP-01-004 step 3)');
    }
    const [row] = await withTenantContext(this.db, tenantId, (tx) => tx.update(offerConditions).set({
      statusCode: input.statusCode, decidedBy: actorId, decidedAt: clockNow(), decisionNote: input.note ?? null,
    }).where(eq(offerConditions.id, condition.id)).returning());
    return row!;
  }

  /**
   * The overall confirmation decision. Freezes the condition versions it
   * tested; a confirmed applicant is handed to enrolment through the
   * Admissions workflow.
   */
  async confirm(tenantId: string, offerId: string, input: { decisionCode: 'confirmed' | 'confirmed-alternative' | 'unsuccessful'; alternativeProgrammeId?: string; reason?: string }, actorId: string): Promise<OfferConfirmationDecision> {
    const offer = await this.#offer(tenantId, offerId);
    if (offer.statusCode !== 'accepted') throw new ConflictError('Only an accepted offer can be confirmed');
    const conditions = await withTenantContext(this.db, tenantId, (tx) => tx.select().from(offerConditions).where(eq(offerConditions.offerId, offer.id)).orderBy(asc(offerConditions.id)));
    const outstanding = conditions.filter((c) => c.statusCode !== 'met' && c.statusCode !== 'waived');
    if (input.decisionCode === 'confirmed' && outstanding.length > 0) {
      throw new ConflictError(`Conditions are not all met or waived: ${outstanding.map((c) => c.description).join('; ')}`);
    }
    if (input.decisionCode === 'confirmed-alternative') {
      if (!input.alternativeProgrammeId) throw new ValidationError('An alternative confirmation names the alternative programme');
      await this.#requireProgramme(tenantId, input.alternativeProgrammeId);
    }
    if (input.decisionCode !== 'confirmed' && !input.reason) throw new ValidationError('An alternative or unsuccessful outcome needs a reason');

    const app = await this.#app(tenantId, offer.applicationId);
    let handoffWorkflowInstanceId: string | null = null;
    if (input.decisionCode !== 'unsuccessful') {
      // A UCAS application hands off its UCAS record, the same subject the UCAS adapter would,
      // so a later 'confirmed' status from UCAS does not start a second hand-off.
      const handoff = await this.admissions.startHandoff(tenantId, {
        applicationId: app.ucasApplicationId ?? app.id, sourceApplicationReference: app.sourceReference, source: app.channelCode as AdmissionSourceCode,
        cycle: app.cycle, statusCode: input.decisionCode, rawPayload: {},
      }, actorId);
      handoffWorkflowInstanceId = handoff.workflowInstanceId;
    }
    const confirmRegistration = await this.#ucasRegistration(tenantId, app, actorId);
    return withTenantContext(this.db, tenantId, async (tx) => {
      const [decision] = await tx.insert(offerConfirmationDecisions).values({
        tenantId: tenantId as Uuid, offerId: offer.id, decisionCode: input.decisionCode,
        alternativeProgrammeId: (input.alternativeProgrammeId ?? null) as Uuid | null,
        conditionSnapshot: conditions.map((c) => ({ conditionId: c.id, description: c.description, requiredValue: c.requiredValue, statusCode: c.statusCode, decidedBy: c.decidedBy })),
        reason: input.reason ?? null, handoffWorkflowInstanceId: handoffWorkflowInstanceId as Uuid | null, decidedBy: actorId,
      }).returning();
      await tx.update(admissionsOffers).set({ statusCode: input.decisionCode === 'unsuccessful' ? 'unsuccessful' : 'confirmed' })
        .where(eq(admissionsOffers.id, offer.id));
      await this.#queueForUcas(tx, tenantId, confirmRegistration, app, input.decisionCode, `ucas-outcome:${decision!.id}`,
        { offerId: offer.id, ...(input.alternativeProgrammeId ? { alternativeProgrammeId: input.alternativeProgrammeId } : {}) });
      return decision!;
    });
  }

  // ── Reads ──────────────────────────────────────────────────────────────────

  async get(tenantId: string, applicationId: string): Promise<ApplicationDto> {
    const app = await this.#app(tenantId, applicationId);
    return withTenantContext(this.db, tenantId, async (tx) => {
      const assessments = await tx.select().from(applicationAssessments).where(eq(applicationAssessments.applicationId, app.id)).orderBy(asc(applicationAssessments.assessedAt));
      const offers = await tx.select().from(admissionsOffers).where(eq(admissionsOffers.applicationId, app.id)).orderBy(asc(admissionsOffers.version));
      const offerIds = offers.map((o) => o.id);
      const conditions = offerIds.length ? await tx.select().from(offerConditions).where(inArray(offerConditions.offerId, offerIds)) : [];
      const evidence = conditions.length ? await tx.select().from(conditionEvidence).where(inArray(conditionEvidence.conditionId, conditions.map((c) => c.id))) : [];
      const confirmations = offerIds.length ? await tx.select().from(offerConfirmationDecisions).where(inArray(offerConfirmationDecisions.offerId, offerIds)) : [];
      return {
        ...app,
        assessments,
        offers: offers.map((o) => ({
          ...o,
          conditions: conditions.filter((c) => c.offerId === o.id).map((c) => ({ ...c, evidence: evidence.filter((e) => e.conditionId === c.id) })),
          confirmation: confirmations.find((d) => d.offerId === o.id) ?? null,
        })),
      };
    });
  }

  /** Applications needing attention: routed to a worklist or awaiting assessment or decision. */
  async worklist(tenantId: string): Promise<StudentApplication[]> {
    return withTenantContext(this.db, tenantId, (tx) => tx.select().from(studentApplications).where(and(
      eq(studentApplications.tenantId, tenantId as Uuid),
      sql`(${studentApplications.routingReasonCode} IS NOT NULL OR ${studentApplications.statusCode} IN ('received', 'under-assessment', 'recommended'))`,
    )).orderBy(desc(studentApplications.createdAt)).limit(200));
  }

  // ── internals ──────────────────────────────────────────────────────────────

  /** Certain evidence only: an explicit person, or an exact student-number match. Name matches are flagged, never merged. */
  async #matchApplicant(tenantId: string, input: ReceiveApplicationInput): Promise<{ personId?: string; matchCode: 'matched' | 'created' | 'needs-review' }> {
    const a = input.applicant;
    return withTenantContext(this.db, tenantId, async (tx) => {
      if (a.personId) {
        const [p] = await tx.select({ id: persons.id }).from(persons).where(and(eq(persons.id, a.personId as Uuid), eq(persons.tenantId, tenantId as Uuid))).limit(1);
        if (p) return { personId: p.id, matchCode: 'matched' as const };
      }
      if (a.studentNumber) {
        const [p] = await tx.select({ id: persons.id }).from(persons).where(and(eq(persons.studentNumber, a.studentNumber), eq(persons.tenantId, tenantId as Uuid))).limit(1);
        if (p) return { personId: p.id, matchCode: 'matched' as const };
      }
      const similar = await tx.select({ id: personIdentities.personId }).from(personIdentities).where(and(
        eq(personIdentities.tenantId, tenantId as Uuid), isNull(personIdentities.recordedUntil),
        sql`lower(${personIdentities.legalFirstName}) = lower(${a.legalFirstName})`,
        sql`lower(${personIdentities.legalFamilyName}) = lower(${a.legalFamilyName})`,
      )).limit(1);
      if (similar[0]) return { matchCode: 'needs-review' as const };
      return null;
    }).then(async (result) => {
      if (result) return result;
      const created = await this.students.createPerson(tenantId, {
        legalFirstName: a.legalFirstName, legalFamilyName: a.legalFamilyName,
        ...(a.dateOfBirth ? { dateOfBirth: a.dateOfBirth } : {}), ...(a.emailPersonal ? { emailPersonal: a.emailPersonal } : {}),
        sourceSystem: input.channelCode, sourceReference: input.sourceReference,
      });
      return { personId: created.personId, matchCode: 'created' as const };
    });
  }

  async #routeFacts(tenantId: string, input: ReceiveApplicationInput, lenient: boolean): Promise<{
    programmeId: string | null; intakeCode: string | null; modeOfStudyCode: string | null; complete: boolean;
  }> {
    let programmeId = input.programmeId ?? null;
    let modeOfStudyCode = input.modeOfStudyCode ?? null;
    const intakeCode = input.intakeCode ?? null;
    if (!lenient) {
      if (!programmeId || !modeOfStudyCode || !intakeCode) throw new ValidationError('An application names its programme, intake and mode of study');
      await this.#code(tenantId, 'enrolment', 'mode_of_study_code', modeOfStudyCode);
      await this.#requireProgramme(tenantId, programmeId);
      return { programmeId, intakeCode, modeOfStudyCode, complete: true };
    }
    // From a channel adapter, an unrecognised value is treated as not yet known.
    if (programmeId) {
      const rows = await withTenantContext(this.db, tenantId, (tx) => tx.select({ id: programmes.id }).from(programmes)
        .where(and(eq(programmes.id, programmeId as Uuid), eq(programmes.tenantId, tenantId as Uuid))).limit(1));
      if (!rows[0]) programmeId = null;
    }
    if (modeOfStudyCode) {
      try { await this.#code(tenantId, 'enrolment', 'mode_of_study_code', modeOfStudyCode); } catch (err) {
        if (!(err instanceof ValidationError)) throw err;
        modeOfStudyCode = null;
      }
    }
    return { programmeId, intakeCode, modeOfStudyCode, complete: Boolean(programmeId && intakeCode && modeOfStudyCode) };
  }

  /** The channel-neutral application received through the UCAS adapter for one UCAS record. */
  async findByUcasApplication(tenantId: string, ucasApplicationId: string): Promise<StudentApplication | null> {
    const [row] = await withTenantContext(this.db, tenantId, (tx) => tx.select().from(studentApplications).where(and(
      eq(studentApplications.tenantId, tenantId as Uuid), eq(studentApplications.ucasApplicationId, ucasApplicationId as Uuid),
    )).limit(1));
    return row ?? null;
  }

  async #validateTerms(tenantId: string, terms: OfferTerms): Promise<void> {
    const conditions = terms.conditions ?? [];
    if (terms.feeStatusBasisCode) await this.#code(tenantId, 'admissions_offer', 'fee_status_basis_code', terms.feeStatusBasisCode);
    if (terms.offerTypeCode === 'conditional' && conditions.length === 0) throw new ValidationError('A conditional offer needs at least one condition');
    if (terms.offerTypeCode === 'unconditional' && conditions.length > 0) throw new ValidationError('An unconditional offer has no conditions');
    for (const c of conditions) {
      await this.#code(tenantId, 'offer_condition', 'condition_type_code', c.conditionTypeCode);
      if (c.matchCriteria) await this.#validateCriteria(c.matchCriteria);
    }
  }

  async #validateCriteria(m: ConditionMatchCriteria): Promise<void> {
    const { valueSetMembers, valueSets: sets } = await import('@revelation-srs/db');
    const members = async (setCode: string) => (await this.db.select({ code: valueSetMembers.code }).from(valueSetMembers)
      .innerJoin(sets, eq(sets.id, valueSetMembers.valueSetId)).where(eq(sets.setCode, setCode))).map((r) => r.code);
    if (!(await members('qualification-type-code')).includes(m.qualificationTypeCode)) throw new ValidationError(`Unknown qualification type '${m.qualificationTypeCode}'`);
    if (!m.gradeScale.startsWith('grade-scale-')) throw new ValidationError('A grade scale is a grade-scale value set');
    if (!(await members(m.gradeScale)).includes(m.minimumGrade)) throw new ValidationError(`'${m.minimumGrade}' is not a grade on ${m.gradeScale}`);
  }

  async #insertConditions(tx: Parameters<Parameters<typeof withTenantContext>[2]>[0], tenantId: string, offerId: string, conditions: NonNullable<OfferTerms['conditions']>) {
    if (conditions.length === 0) return;
    await tx.insert(offerConditions).values(conditions.map((c) => ({
      tenantId: tenantId as Uuid, offerId: offerId as Uuid, conditionTypeCode: c.conditionTypeCode,
      description: c.description, requiredValue: c.requiredValue ?? null, matchCriteria: c.matchCriteria ?? null,
    })));
  }

  async #assessments(tenantId: string, applicationId: string) {
    return withTenantContext(this.db, tenantId, (tx) => tx.select().from(applicationAssessments).where(eq(applicationAssessments.applicationId, applicationId as Uuid)));
  }

  async #bySource(tenantId: string, channel: string, ref: string): Promise<StudentApplication | null> {
    const [row] = await withTenantContext(this.db, tenantId, (tx) => tx.select().from(studentApplications).where(and(
      eq(studentApplications.tenantId, tenantId as Uuid), eq(studentApplications.channelCode, channel), eq(studentApplications.sourceReference, ref),
    )).limit(1));
    return row ?? null;
  }

  async #app(tenantId: string, id: string): Promise<StudentApplication> {
    const [row] = await withTenantContext(this.db, tenantId, (tx) => tx.select().from(studentApplications)
      .where(and(eq(studentApplications.id, id as Uuid), eq(studentApplications.tenantId, tenantId as Uuid))).limit(1));
    if (!row) throw new NotFoundError('StudentApplication', id);
    return row;
  }

  async #offer(tenantId: string, id: string): Promise<AdmissionsOffer> {
    const [row] = await withTenantContext(this.db, tenantId, (tx) => tx.select().from(admissionsOffers)
      .where(and(eq(admissionsOffers.id, id as Uuid), eq(admissionsOffers.tenantId, tenantId as Uuid))).limit(1));
    if (!row) throw new NotFoundError('AdmissionsOffer', id);
    return row;
  }

  async #condition(tenantId: string, id: string): Promise<OfferCondition> {
    const [row] = await withTenantContext(this.db, tenantId, (tx) => tx.select().from(offerConditions)
      .where(and(eq(offerConditions.id, id as Uuid), eq(offerConditions.tenantId, tenantId as Uuid))).limit(1));
    if (!row) throw new NotFoundError('OfferCondition', id);
    return row;
  }

  async #requireProgramme(tenantId: string, programmeId: string): Promise<void> {
    const rows = await withTenantContext(this.db, tenantId, (tx) => tx.select({ id: programmes.id }).from(programmes)
      .where(and(eq(programmes.id, programmeId as Uuid), eq(programmes.tenantId, tenantId as Uuid))).limit(1));
    if (!rows[0]) throw new NotFoundError('Programme', programmeId);
  }

  async #code(tenantId: string, entity: string, field: string, value: string): Promise<void> {
    if ((await this.valueSets.validateFieldValue(entity, field, value, tenantId)) === false) {
      throw new ValidationError(`Invalid value '${value}' for ${entity}.${field}`, [{ field, message: 'Value is not active in the configured value set' }]);
    }
  }
}
