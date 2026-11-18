import { createPostgresDocumentAdapter, DocumentTooLargeError, DocumentTypeNotAllowedError } from '@revelation-srs/documents';
import {
  admissionsOffers,
  casAssignmentVersions,
  casCases,
  conditionEvidence,
  offerConditions,
  offerConfirmationDecisions,
  programmes,
  studentApplications,
  tenants,
  type Db,
  withTenantContext,
} from '@revelation-srs/db';
import { ConflictError, NotFoundError, ValidationError } from '@revelation-srs/domain';
import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';

import { clockNow } from '../clock.js';
import type { ValueSetService } from '../value-sets/service.js';

import type { ApplicationService } from './application-service.js';

type Uuid = `${string}-${string}-${string}-${string}-${string}`;

/** How an application looks to its applicant (D-39). */
export type ApplicantStatus =
  | 'received' | 'under-consideration' | 'offer-made' | 'offer-accepted' | 'offer-declined'
  | 'conditions-met' | 'unsuccessful' | 'withdrawn' | 'confirmed' | 'confirmed-alternative';

/**
 * An applicant's view of one application, built from a fixed list of
 * fields (D-39). Assessments, recommendations, routing, identity matching,
 * received payloads, decision makers' names, condition decision notes,
 * match outcomes, embargoed evidence and CAS eligibility checks are never
 * included: anything not listed here is withheld.
 */
export interface ApplicantApplicationView {
  applicationId: string;
  channelCode: string;
  cycle: string;
  programme: { programmeId: string | null; code: string | null; title: string | null };
  intakeCode: string | null;
  modeOfStudyCode: string | null;
  status: ApplicantStatus;
  /** True where the applicant replies through another channel (UCAS Hub). */
  respondElsewhere: boolean;
  offer: null | {
    offerId: string;
    version: number;
    offerTypeCode: string;
    statusCode: string;
    expiresOn: string | null;
    responseCode: string | null;
    respondedAt: Date | null;
    conditions: Array<{
      conditionId: string;
      description: string;
      requiredValue: string | null;
      statusCode: string;
      evidence: Array<{ evidenceId: string; receivedAt: Date; verified: boolean }>;
    }>;
  };
  confirmation: null | { outcomeCode: string; decidedAt: Date };
  cas: null | { statusCode: string; casNumber: string | null };
  withdrawnAt: Date | null;
}

interface PortalConfig { enabled: boolean; readOnlyChannels: string[] }

/**
 * Applicant self-service (Phase 5 D-39, ADR-025). An applicant sees only
 * applications bound to their person with a certain identity match; nothing
 * shows while a match needs review. They may reply to an offer and
 * withdraw, except on channels that reply elsewhere (UCAS and Clearing by
 * default), and upload evidence for a pending condition, which a person
 * still verifies and decides.
 */
export class ApplicantPortalService {
  constructor(
    private readonly db: Db,
    private readonly applications: ApplicationService,
    private readonly valueSets: ValueSetService,
  ) {}

  async list(tenantId: string, personId: string): Promise<ApplicantApplicationView[]> {
    const config = await this.#config(tenantId);
    const apps = await withTenantContext(this.db, tenantId, (tx) => tx.select().from(studentApplications).where(and(
      eq(studentApplications.tenantId, tenantId as Uuid), eq(studentApplications.personId, personId as Uuid),
      inArray(studentApplications.identityMatchCode, ['matched', 'created']),
    )).orderBy(desc(studentApplications.createdAt)));
    const out: ApplicantApplicationView[] = [];
    for (const app of apps) out.push(await this.#view(tenantId, app, config));
    return out;
  }

  async get(tenantId: string, personId: string, applicationId: string): Promise<ApplicantApplicationView> {
    const app = await this.#own(tenantId, personId, applicationId);
    return this.#view(tenantId, app, await this.#config(tenantId));
  }

  /** Accept or decline the current offer (BP-01-003 step 5). */
  async respond(tenantId: string, personId: string, offerId: string, responseCode: 'accept' | 'decline', actorId: string): Promise<ApplicantApplicationView> {
    const offer = await this.#offer(tenantId, offerId);
    const app = await this.#own(tenantId, personId, offer.applicationId);
    await this.#assertSelfService(tenantId, app.channelCode, 'Reply to this offer in UCAS Hub');
    await this.applications.respond(tenantId, offerId, { responseCode, sourceTimestamp: clockNow().toISOString() }, { respondedBy: actorId, channelCode: 'applicant-portal' });
    return this.get(tenantId, personId, app.id);
  }

  /**
   * Evidence for a pending condition of the current offer (BP-01-004 step
   * 2). Stored in the documents library and recorded unverified; it does not
   * change the condition.
   */
  async uploadEvidence(tenantId: string, personId: string, conditionId: string, file: { filename: string; mimeType: string; content: Buffer }, actorId: string): Promise<{ evidenceId: string }> {
    const [condition] = await withTenantContext(this.db, tenantId, (tx) => tx.select().from(offerConditions)
      .where(and(eq(offerConditions.tenantId, tenantId as Uuid), eq(offerConditions.id, conditionId as Uuid))).limit(1));
    if (!condition) throw new NotFoundError('OfferCondition', conditionId);
    const offer = await this.#offer(tenantId, condition.offerId);
    await this.#own(tenantId, personId, offer.applicationId);
    if (!['made', 'accepted'].includes(offer.statusCode)) throw new ConflictError(`This offer is ${offer.statusCode}; evidence is no longer needed`);
    if (condition.statusCode !== 'pending') throw new ConflictError(`This condition is already ${condition.statusCode}`);

    return withTenantContext(this.db, tenantId, async (tx) => {
      let stored;
      try {
        stored = await createPostgresDocumentAdapter(tx).store({
          tenantId, ownerService: 'srs-admissions', ownerRef: condition.id, filename: file.filename, mimeType: file.mimeType, content: file.content, actorId,
        });
      } catch (err) {
        if (err instanceof DocumentTooLargeError || err instanceof DocumentTypeNotAllowedError) throw new ValidationError(err.message);
        throw err;
      }
      const [row] = await tx.insert(conditionEvidence).values({
        tenantId: tenantId as Uuid, conditionId: condition.id, provenanceCode: 'applicant',
        evidenceRef: `documents:${stored.documentId}`, reportedValue: null, verified: false, receivedBy: actorId,
      }).returning();
      return { evidenceId: row!.id };
    });
  }

  /** Withdraw an application before it is converted (BP-01-003). */
  async withdraw(tenantId: string, personId: string, applicationId: string, reasonCode: string | undefined, actorId: string): Promise<ApplicantApplicationView> {
    const app = await this.#own(tenantId, personId, applicationId);
    await this.#assertSelfService(tenantId, app.channelCode, 'Withdraw this application in UCAS Hub');
    if (reasonCode) {
      const ok = await this.valueSets.validateFieldValue('student_application', 'withdrawal_reason_code', reasonCode, tenantId);
      if (!ok) throw new ValidationError(`Unknown withdrawal reason '${reasonCode}'`);
    }
    if (['withdrawn', 'rejected'].includes(app.statusCode)) throw new ConflictError(`This application is already ${app.statusCode}`);
    const offers = await withTenantContext(this.db, tenantId, (tx) => tx.select().from(admissionsOffers)
      .where(and(eq(admissionsOffers.tenantId, tenantId as Uuid), eq(admissionsOffers.applicationId, app.id))).orderBy(asc(admissionsOffers.version)));
    const confirmed = offers.find((o) => o.statusCode === 'confirmed');
    if (confirmed) {
      throw new ConflictError('This application has been confirmed and you are being enrolled; to leave, ask the registry about withdrawing from your studies');
    }
    for (const o of offers.filter((x) => ['made', 'accepted'].includes(x.statusCode))) await this.applications.withdrawOffer(tenantId, o.id);
    await withTenantContext(this.db, tenantId, (tx) => tx.update(studentApplications).set({
      statusCode: 'withdrawn', withdrawnAt: clockNow(), withdrawnBy: actorId, withdrawalReasonCode: reasonCode ?? null, updatedAt: clockNow(),
    }).where(eq(studentApplications.id, app.id)));
    return this.get(tenantId, personId, app.id);
  }

  async #view(tenantId: string, app: typeof studentApplications.$inferSelect, config: PortalConfig): Promise<ApplicantApplicationView> {
    const data = await withTenantContext(this.db, tenantId, async (tx) => {
      const offers = await tx.select().from(admissionsOffers).where(and(eq(admissionsOffers.tenantId, tenantId as Uuid), eq(admissionsOffers.applicationId, app.id))).orderBy(asc(admissionsOffers.version));
      const current = [...offers].reverse().find((o) => o.statusCode !== 'superseded') ?? null;
      const conditions = current ? await tx.select().from(offerConditions).where(eq(offerConditions.offerId, current.id)) : [];
      const evidence = conditions.length > 0 ? await tx.select().from(conditionEvidence).where(and(
        inArray(conditionEvidence.conditionId, conditions.map((c) => c.id)), eq(conditionEvidence.provenanceCode, 'applicant'),
      )) : [];
      const confirmation = current ? (await tx.select().from(offerConfirmationDecisions).where(eq(offerConfirmationDecisions.offerId, current.id)).limit(1))[0] ?? null : null;
      const programme = app.programmeId ? (await tx.select({ code: programmes.code, title: programmes.title }).from(programmes)
        .where(and(eq(programmes.id, app.programmeId), isNull(programmes.recordedUntil))).limit(1))[0] ?? null : null;
      const cas = (await tx.select().from(casCases).where(and(eq(casCases.tenantId, tenantId as Uuid), eq(casCases.applicationId, app.id), isNull(casCases.recordedUntil))).limit(1))[0] ?? null;
      const casVersion = cas ? (await tx.select({ casNumber: casAssignmentVersions.casNumber }).from(casAssignmentVersions)
        .where(eq(casAssignmentVersions.casCaseId, cas.id)).orderBy(desc(casAssignmentVersions.versionNumber)).limit(1))[0] ?? null : null;
      return { current, conditions, evidence, confirmation, programme, cas, casVersion };
    });
    const now = clockNow();
    const { current, conditions } = data;
    const status = applicantStatus(app.statusCode, current?.statusCode ?? null, conditions.map((c) => c.statusCode), data.confirmation?.decisionCode ?? null);
    return {
      applicationId: app.id,
      channelCode: app.channelCode,
      cycle: app.cycle,
      programme: { programmeId: app.programmeId, code: data.programme?.code ?? null, title: data.programme?.title ?? null },
      intakeCode: app.intakeCode,
      modeOfStudyCode: app.modeOfStudyCode,
      status,
      respondElsewhere: config.readOnlyChannels.includes(app.channelCode),
      offer: current ? {
        offerId: current.id, version: current.version, offerTypeCode: current.offerTypeCode, statusCode: current.statusCode,
        expiresOn: current.expiresOn, responseCode: current.responseCode, respondedAt: current.respondedAt,
        conditions: conditions.map((c) => ({
          conditionId: c.id, description: c.description, requiredValue: c.requiredValue, statusCode: c.statusCode,
          evidence: data.evidence
            .filter((e) => e.conditionId === c.id && (!e.embargoedUntil || new Date(`${e.embargoedUntil}T00:00:00Z`) <= now))
            .map((e) => ({ evidenceId: e.id, receivedAt: e.receivedAt, verified: e.verified })),
        })),
      } : null,
      confirmation: data.confirmation ? { outcomeCode: data.confirmation.decisionCode, decidedAt: data.confirmation.decidedAt } : null,
      cas: data.cas ? { statusCode: data.cas.statusCode, casNumber: data.casVersion?.casNumber ?? null } : null,
      withdrawnAt: app.withdrawnAt,
    };
  }

  /** The application, if it is this person's and its identity is certain; otherwise not found. */
  async #own(tenantId: string, personId: string, applicationId: string): Promise<typeof studentApplications.$inferSelect> {
    const [app] = await withTenantContext(this.db, tenantId, (tx) => tx.select().from(studentApplications).where(and(
      eq(studentApplications.tenantId, tenantId as Uuid), eq(studentApplications.id, applicationId as Uuid),
    )).limit(1));
    if (!app || app.personId !== personId || !['matched', 'created'].includes(app.identityMatchCode)) throw new NotFoundError('Application', applicationId);
    return app;
  }

  async #offer(tenantId: string, offerId: string): Promise<typeof admissionsOffers.$inferSelect> {
    const [offer] = await withTenantContext(this.db, tenantId, (tx) => tx.select().from(admissionsOffers)
      .where(and(eq(admissionsOffers.tenantId, tenantId as Uuid), eq(admissionsOffers.id, offerId as Uuid))).limit(1));
    if (!offer) throw new NotFoundError('AdmissionsOffer', offerId);
    return offer;
  }

  async #assertSelfService(tenantId: string, channelCode: string, elsewhere: string): Promise<void> {
    const config = await this.#config(tenantId);
    if (!config.enabled) throw new ConflictError('Applicants cannot act through this portal; contact admissions');
    if (config.readOnlyChannels.includes(channelCode)) throw new ConflictError(elsewhere);
  }

  async #config(tenantId: string): Promise<PortalConfig> {
    const [row] = await this.db.select({ configuration: tenants.configuration }).from(tenants).where(eq(tenants.id, tenantId as Uuid)).limit(1);
    const portal = (((row?.configuration?.['admissions'] ?? {}) as Record<string, unknown>)['applicantPortal'] ?? {}) as Record<string, unknown>;
    const channels = portal['readOnlyChannels'];
    return {
      enabled: portal['enabled'] !== false,
      readOnlyChannels: Array.isArray(channels) && channels.every((c) => typeof c === 'string') ? channels : ['ucas', 'clearing'],
    };
  }
}

/** The applicant-facing status, from the application, its current offer and the confirmation (D-39). */
export function applicantStatus(applicationStatus: string, offerStatus: string | null, conditionStatuses: string[], confirmation: string | null): ApplicantStatus {
  if (applicationStatus === 'withdrawn') return 'withdrawn';
  if (applicationStatus === 'rejected') return 'unsuccessful';
  if (confirmation === 'confirmed') return 'confirmed';
  if (confirmation === 'confirmed-alternative') return 'confirmed-alternative';
  if (confirmation === 'unsuccessful') return 'unsuccessful';
  switch (offerStatus) {
    case 'made': return 'offer-made';
    case 'accepted': return conditionStatuses.length > 0 && conditionStatuses.every((c) => c === 'met' || c === 'waived') ? 'conditions-met' : 'offer-accepted';
    case 'declined': return 'offer-declined';
    case 'expired':
    case 'withdrawn':
    case 'unsuccessful': return 'unsuccessful';
    default: break;
  }
  return ['received', 'incomplete'].includes(applicationStatus) ? 'received' : 'under-consideration';
}
