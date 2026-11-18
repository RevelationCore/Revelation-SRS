import { createHash, randomUUID } from 'node:crypto';

import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  admissionsOffers,
  casAssignmentVersions,
  casCases,
  casEligibilityChecks,
  enrolments,
  personIdentities,
  programmes,
  sponsorReportVersions,
  studentApplications,
  tenants,
  type CasCase,
  type Db,
  withTenantContext,
} from '@revelation-srs/db';
import {
  ConflictError,
  EVENT_TYPES,
  NotFoundError,
  ValidationError,
  type RegulatoryUkviCasAssignedV1Payload,
  type RegulatoryUkviCasRequestedV1Payload,
} from '@revelation-srs/domain';

import { clockNow } from '../clock.js';
import type { IntegrationBusPublisher } from '../integration-bus/publisher.js';

import { RegulatoryExchangeService } from './exchange-service.js';

type Uuid = `${string}-${string}-${string}-${string}-${string}`;

/**
 * One CAS record (BPR-D03; Phase 3 D-16). A case is opened for an applicant
 * who needs a Student visa (or for an enrolled student's in-country
 * extension), its eligibility checks are recorded with their guidance
 * version, the CAS data is prepared and then approved by someone else,
 * exported to the Sponsor Management System as a file, and the CAS number
 * SMS assigns is recorded on that assignment version. A correction is a new
 * assignment version; earlier versions are kept (ADR-022).
 */

export const OPEN_CAS_STATUSES = ['opened', 'eligibility-checked', 'prepared', 'approved', 'requested'];
export const CAS_SMS_CONTRACT = 'ukvi-sponsor-compliance.v1';

export interface CasCaseDto {
  casCaseId:       string;
  personId:        string;
  applicationId:   string | null;
  enrolmentId:     string | null;
  casReference:    string | null;
  statusCode:      string;
  preparedBy:      string | null;
  preparedPayload: Record<string, unknown> | null;
  actorId:         string;
  validFrom:       Date;
  validTo:         Date | null;
  recordedAt:      Date;
  recordedUntil:   Date | null;
}

export interface CasCaseDetailDto extends CasCaseDto {
  openedAt: Date;
  subject: { studentName: string | null; programmeCode: string | null; programmeTitle: string | null };
  eligibilityChecks: Array<{ checkId: string; guidanceVersion: string; checkTypeCode: string; resultCode: string; checkedBy: string; checkedAt: Date }>;
  assignmentVersions: Array<{ assignmentVersionId: string; versionNumber: number; assignedPayloadHash: string; casNumber: string | null; approvedBy: string; approvedAt: Date; smsRequestSentAt: Date | null; smsReceiptRef: string | null }>;
  /** Why a CAS officer must look at this case: the applicant withdrew while it was still in hand (D-39). */
  attentionReason: 'application-withdrawn' | null;
}

export interface RecordEligibilityCheckInput {
  guidanceVersion: string;
  checkTypeCode:   string;
  resultCode:      string;
  evidenceRef?:    string;
}

export interface RecordSponsorReportVersionInput {
  reportPayloadRef:    string;
  distributionItemId?: string;
}

export interface CasSmsExport {
  contract: 'ukvi/cas-request-outbound.v2';
  generatedAt: string;
  processedCount: number;
  casRequests: Array<{ casCaseId: string; assignmentVersionId: string; versionNumber: number; payloadHash: string; personData: Record<string, unknown> }>;
}

const hashPayload = (p: unknown) => createHash('sha256').update(JSON.stringify(p)).digest('hex');

export class CasCaseService {
  private readonly exchanges: RegulatoryExchangeService;

  constructor(
    private readonly db: Db,
    private readonly eventBus?: IntegrationBusPublisher,
    exchanges?: RegulatoryExchangeService,
  ) {
    this.exchanges = exchanges ?? new RegulatoryExchangeService(db);
  }

  // ── Opening ────────────────────────────────────────────────────────────────

  /** A new entrant who needs a Student visa: the CAS belongs to the application until conversion. */
  async openForApplication(tenantId: string, applicationId: string, actorId: string): Promise<CasCaseDetailDto> {
    const [app] = await withTenantContext(this.db, tenantId, (tx) => tx.select().from(studentApplications)
      .where(and(eq(studentApplications.tenantId, tenantId as Uuid), eq(studentApplications.id, applicationId as Uuid))).limit(1));
    if (!app) throw new NotFoundError('Application', applicationId);
    if (!app.personId) throw new ConflictError('Confirm the applicant identity before opening a CAS case');
    if (await this.openCaseForApplication(tenantId, applicationId)) throw new ConflictError('This application already has an open CAS case');
    const id = await this.#insert(tenantId, { personId: app.personId, applicationId, enrolmentId: null }, actorId);
    return this.getCase(tenantId, id);
  }

  /** An enrolled student's in-country extension or course change. */
  async openForEnrolment(tenantId: string, enrolmentId: string, actorId: string): Promise<CasCaseDetailDto> {
    const [enrolment] = await withTenantContext(this.db, tenantId, (tx) => tx.select({ personId: enrolments.personId }).from(enrolments)
      .where(and(eq(enrolments.tenantId, tenantId as Uuid), eq(enrolments.id, enrolmentId as Uuid), isNull(enrolments.recordedUntil))).limit(1));
    if (!enrolment) throw new NotFoundError('Enrolment', enrolmentId);
    const open = (await this.listCases(tenantId, { enrolmentId })).find((c) => OPEN_CAS_STATUSES.includes(c.statusCode));
    if (open) throw new ConflictError('This enrolment already has an open CAS case');
    const id = await this.#insert(tenantId, { personId: enrolment.personId, applicationId: null, enrolmentId }, actorId);
    return this.getCase(tenantId, id);
  }

  async #insert(tenantId: string, subject: { personId: string; applicationId: string | null; enrolmentId: string | null }, actorId: string): Promise<string> {
    const caseId = randomUUID();
    const now = clockNow();
    await withTenantContext(this.db, tenantId, (tx) => tx.insert(casCases).values({
      versionId: randomUUID(), id: caseId, tenantId: tenantId as Uuid,
      personId: subject.personId as Uuid, applicationId: subject.applicationId as Uuid | null, enrolmentId: subject.enrolmentId as Uuid | null,
      casReference: null, statusCode: 'opened', actorId, validFrom: now, recordedAt: now,
    }));
    return caseId;
  }

  // ── Reads ──────────────────────────────────────────────────────────────────

  async getCurrentCase(casCaseId: string, tenantId: string): Promise<CasCaseDto | null> {
    const rows = await withTenantContext(this.db, tenantId, (tx) => tx.select().from(casCases).where(and(
      eq(casCases.id, casCaseId as Uuid), eq(casCases.tenantId, tenantId as Uuid), isNull(casCases.recordedUntil),
    )).limit(1));
    return rows[0] ? caseToDto(rows[0]) : null;
  }

  async getCase(tenantId: string, casCaseId: string): Promise<CasCaseDetailDto> {
    const [detail] = await this.#details(tenantId, [casCaseId]);
    if (!detail) throw new NotFoundError('CasCase', casCaseId);
    return detail;
  }

  async listCases(tenantId: string, filters: { statusCode?: string; open?: boolean; applicationId?: string; enrolmentId?: string; personId?: string } = {}): Promise<CasCaseDetailDto[]> {
    const rows = await withTenantContext(this.db, tenantId, (tx) => tx.select({ id: casCases.id }).from(casCases).where(and(
      eq(casCases.tenantId, tenantId as Uuid), isNull(casCases.recordedUntil),
      ...(filters.statusCode ? [eq(casCases.statusCode, filters.statusCode)] : []),
      ...(filters.open ? [inArray(casCases.statusCode, OPEN_CAS_STATUSES)] : []),
      ...(filters.applicationId ? [eq(casCases.applicationId, filters.applicationId as Uuid)] : []),
      ...(filters.enrolmentId ? [eq(casCases.enrolmentId, filters.enrolmentId as Uuid)] : []),
      ...(filters.personId ? [eq(casCases.personId, filters.personId as Uuid)] : []),
    )).orderBy(asc(casCases.validFrom)));
    return this.#details(tenantId, rows.map((r) => r.id));
  }

  async listCasesForEnrolment(enrolmentId: string, tenantId: string): Promise<CasCaseDetailDto[]> {
    return this.listCases(tenantId, { enrolmentId });
  }

  /** An application's open case that has no CAS number yet: blocks conversion (D-16). */
  async openCaseForApplication(tenantId: string, applicationId: string): Promise<CasCaseDto | null> {
    const rows = await withTenantContext(this.db, tenantId, (tx) => tx.select().from(casCases).where(and(
      eq(casCases.tenantId, tenantId as Uuid), eq(casCases.applicationId, applicationId as Uuid), isNull(casCases.recordedUntil),
      inArray(casCases.statusCode, OPEN_CAS_STATUSES),
    )).limit(1));
    return rows[0] ? caseToDto(rows[0]) : null;
  }

  /** The current case holding a CAS number, for inbound visa updates. */
  async findByCasReference(tenantId: string, casReference: string): Promise<CasCaseDto | null> {
    const rows = await withTenantContext(this.db, tenantId, (tx) => tx.select().from(casCases).where(and(
      eq(casCases.tenantId, tenantId as Uuid), eq(casCases.casReference, casReference), isNull(casCases.recordedUntil),
    )).limit(1));
    return rows[0] ? caseToDto(rows[0]) : null;
  }

  // ── Eligibility, preparation and approval ──────────────────────────────────

  async recordEligibilityCheck(casCaseId: string, tenantId: string, input: RecordEligibilityCheckInput, actorId: string): Promise<string> {
    const current = await this.#open(tenantId, casCaseId);
    if (!input.guidanceVersion.trim()) throw new ValidationError('Record the sponsor guidance version the check was made under');
    const checkId = randomUUID();
    await withTenantContext(this.db, tenantId, (tx) => tx.insert(casEligibilityChecks).values({
      id: checkId, tenantId: tenantId as Uuid, casCaseId: casCaseId as Uuid,
      guidanceVersion: input.guidanceVersion.trim(), checkTypeCode: input.checkTypeCode, resultCode: input.resultCode,
      evidenceRef: input.evidenceRef ? (input.evidenceRef as Uuid) : null, checkedBy: actorId, checkedAt: clockNow(),
    }));
    // A new check after preparation needs the CAS data preparing (and approving) again.
    if (['opened', 'prepared'].includes(current.statusCode)) await this.#version(tenantId, current, { statusCode: 'eligibility-checked', preparedPayload: null, preparedBy: null }, actorId);
    return checkId;
  }

  /** Prepares the CAS data for approval, from the confirmed offer (or the enrolment) and the applicant's identity. */
  async prepare(tenantId: string, casCaseId: string, actorId: string): Promise<CasCaseDetailDto> {
    const current = await this.#open(tenantId, casCaseId);
    if (!['eligibility-checked', 'prepared'].includes(current.statusCode)) {
      throw new ConflictError(current.statusCode === 'opened' ? 'Record the eligibility checks first' : `A CAS case that is ${current.statusCode} cannot be prepared`);
    }
    const detail = await this.getCase(tenantId, casCaseId);
    // The latest check of each type counts: a failed check can be redone, and the earlier result stays on record.
    const latest = new Map(detail.eligibilityChecks.map((c) => [c.checkTypeCode, c]));
    const failed = [...latest.values()].filter((c) => c.resultCode !== 'pass');
    if (failed.length > 0) throw new ConflictError(`Eligibility checks not passed: ${failed.map((c) => c.checkTypeCode).join(', ')}`);
    const payload = await this.#personData(tenantId, current);
    await this.#version(tenantId, current, { statusCode: 'prepared', preparedPayload: payload, preparedBy: actorId }, actorId);
    return this.getCase(tenantId, casCaseId);
  }

  /** Approval by someone other than the preparer creates the assignment version that is sent to SMS. */
  async approve(tenantId: string, casCaseId: string, actorId: string): Promise<CasCaseDetailDto> {
    const current = await this.#open(tenantId, casCaseId);
    if (current.statusCode !== 'prepared' || !current.preparedPayload) throw new ConflictError('Prepare the CAS data before approving it');
    if (current.preparedBy === actorId && (await this.#approverMustDiffer(tenantId))) {
      throw new ConflictError('The person who prepared the CAS data cannot approve it');
    }
    const prior = await withTenantContext(this.db, tenantId, (tx) => tx.select({ n: casAssignmentVersions.versionNumber }).from(casAssignmentVersions)
      .where(and(eq(casAssignmentVersions.tenantId, tenantId as Uuid), eq(casAssignmentVersions.casCaseId, casCaseId as Uuid)))
      .orderBy(desc(casAssignmentVersions.versionNumber)).limit(1));
    await withTenantContext(this.db, tenantId, (tx) => tx.insert(casAssignmentVersions).values({
      tenantId: tenantId as Uuid, casCaseId: casCaseId as Uuid, versionNumber: (prior[0]?.n ?? 0) + 1,
      assignedPayloadHash: hashPayload(current.preparedPayload), casNumber: null, approvedBy: actorId, approvedAt: clockNow(),
    }));
    await this.#version(tenantId, current, { statusCode: 'approved' }, actorId);
    return this.getCase(tenantId, casCaseId);
  }

  /**
   * The manual file for SMS (D-14): every approved assignment version not yet
   * sent. Exporting marks them sent and records one outbound exchange each.
   */
  async exportForSms(tenantId: string, actorId: string): Promise<CasSmsExport> {
    const approved = await this.listCases(tenantId, { statusCode: 'approved' });
    const now = clockNow();
    const casRequests: CasSmsExport['casRequests'] = [];
    for (const c of approved) {
      const latest = c.assignmentVersions.at(-1);
      if (!latest || latest.smsRequestSentAt || !c.preparedPayload) continue;
      await withTenantContext(this.db, tenantId, (tx) => tx.update(casAssignmentVersions).set({ smsRequestSentAt: now })
        .where(eq(casAssignmentVersions.id, latest.assignmentVersionId as Uuid)));
      await this.exchanges.recordExchange(tenantId, CAS_SMS_CONTRACT, {
        directionCode: 'outbound', exchangeTypeCode: 'ukvi-cas-request', idempotencyKey: `ukvi-cas:${latest.assignmentVersionId}`,
        payloadHash: latest.assignedPayloadHash, statusCode: 'sent', sentAt: now,
        payloadSummary: { casCaseId: c.casCaseId, versionNumber: latest.versionNumber, applicationId: c.applicationId, enrolmentId: c.enrolmentId },
      }, actorId);
      await this.#version(tenantId, c, { statusCode: 'requested' }, actorId);
      if (c.enrolmentId) {
        await this.#publish(EVENT_TYPES.REGULATORY_UKVI_CAS_REQUESTED, tenantId, actorId,
          { enrolmentId: c.enrolmentId, casRequestId: c.casCaseId, requestedAt: now.toISOString() } satisfies RegulatoryUkviCasRequestedV1Payload);
      }
      casRequests.push({ casCaseId: c.casCaseId, assignmentVersionId: latest.assignmentVersionId, versionNumber: latest.versionNumber, payloadHash: latest.assignedPayloadHash, personData: c.preparedPayload });
    }
    return { contract: 'ukvi/cas-request-outbound.v2', generatedAt: now.toISOString(), processedCount: casRequests.length, casRequests };
  }

  /** The CAS number and SMS receipt, recorded on the assignment version that was sent. */
  async recordCasNumber(tenantId: string, casCaseId: string, input: { casNumber: string; smsReceiptRef?: string }, actorId: string): Promise<CasCaseDetailDto> {
    const current = await this.#open(tenantId, casCaseId);
    if (current.statusCode !== 'requested') throw new ConflictError('Export the approved CAS data to SMS before recording the CAS number');
    const casNumber = input.casNumber.trim();
    if (!/^[A-Z0-9]{14}$/i.test(casNumber)) throw new ValidationError('A CAS number is 14 letters and digits');
    const existing = await this.findByCasReference(tenantId, casNumber);
    if (existing && existing.casCaseId !== casCaseId) throw new ConflictError('That CAS number is already recorded on another case');
    const detail = await this.getCase(tenantId, casCaseId);
    const latest = detail.assignmentVersions.at(-1)!;
    await withTenantContext(this.db, tenantId, (tx) => tx.update(casAssignmentVersions)
      .set({ casNumber, smsReceiptRef: input.smsReceiptRef?.trim() || null })
      .where(eq(casAssignmentVersions.id, latest.assignmentVersionId as Uuid)));
    await this.#version(tenantId, current, { statusCode: 'assigned', casReference: casNumber }, actorId);
    if (current.enrolmentId) {
      await this.#publish(EVENT_TYPES.REGULATORY_UKVI_CAS_ASSIGNED, tenantId, actorId,
        { enrolmentId: current.enrolmentId, casRequestId: casCaseId, casReference: casNumber, assignedAt: clockNow().toISOString() } satisfies RegulatoryUkviCasAssignedV1Payload);
    }
    return this.getCase(tenantId, casCaseId);
  }

  /** A correction after assignment: a new preparation and approval, keeping the earlier version. */
  async reopenForCorrection(tenantId: string, casCaseId: string, actorId: string): Promise<CasCaseDetailDto> {
    const current = await this.getCurrentCase(casCaseId, tenantId);
    if (!current) throw new NotFoundError('CasCase', casCaseId);
    if (current.statusCode !== 'assigned') throw new ConflictError('Only an assigned CAS is corrected this way');
    await this.#version(tenantId, current, { statusCode: 'eligibility-checked', preparedPayload: null, preparedBy: null }, actorId);
    return this.getCase(tenantId, casCaseId);
  }

  async withdraw(tenantId: string, casCaseId: string, actorId: string): Promise<CasCaseDetailDto> {
    const current = await this.getCurrentCase(casCaseId, tenantId);
    if (!current) throw new NotFoundError('CasCase', casCaseId);
    if (current.statusCode === 'withdrawn') throw new ConflictError('This CAS case is already withdrawn');
    await this.#version(tenantId, current, { statusCode: 'withdrawn' }, actorId);
    return this.getCase(tenantId, casCaseId);
  }

  /** Applicant conversion (D-10) attaches the new enrolment to the application's CAS cases. */
  async attachEnrolment(tenantId: string, applicationId: string, enrolmentId: string, actorId: string): Promise<void> {
    const cases = await this.listCases(tenantId, { applicationId });
    for (const c of cases) {
      if (c.enrolmentId || c.statusCode === 'withdrawn') continue;
      await this.#version(tenantId, c, { enrolmentId }, actorId);
      if (c.statusCode === 'assigned' && c.casReference) {
        await this.#publish(EVENT_TYPES.REGULATORY_UKVI_CAS_ASSIGNED, tenantId, actorId,
          { enrolmentId, casRequestId: c.casCaseId, casReference: c.casReference, assignedAt: clockNow().toISOString() } satisfies RegulatoryUkviCasAssignedV1Payload);
      }
    }
  }

  async recordSponsorReportVersion(casCaseId: string, tenantId: string, input: RecordSponsorReportVersionInput, actorId: string): Promise<string> {
    const current = await this.getCurrentCase(casCaseId, tenantId);
    if (!current) throw new NotFoundError('CasCase', casCaseId);
    const [row] = await withTenantContext(this.db, tenantId, (tx) => tx.insert(sponsorReportVersions).values({
      tenantId: tenantId as Uuid, casCaseId: casCaseId as Uuid, generatedBy: actorId,
      reportPayloadRef: input.reportPayloadRef, distributionItemId: input.distributionItemId ? (input.distributionItemId as Uuid) : null,
    }).returning({ id: sponsorReportVersions.id }));
    return row!.id;
  }

  // ── internals ──────────────────────────────────────────────────────────────

  async #open(tenantId: string, casCaseId: string): Promise<CasCaseDto> {
    const current = await this.getCurrentCase(casCaseId, tenantId);
    if (!current) throw new NotFoundError('CasCase', casCaseId);
    if (current.statusCode === 'withdrawn' || current.statusCode === 'assigned') throw new ConflictError(`This CAS case is ${current.statusCode}`);
    return current;
  }

  async #version(tenantId: string, current: CasCaseDto, change: Partial<Pick<CasCaseDto, 'statusCode' | 'casReference' | 'enrolmentId' | 'preparedPayload' | 'preparedBy'>>, actorId: string): Promise<void> {
    const now = clockNow();
    await withTenantContext(this.db, tenantId, async (tx) => {
      await tx.update(casCases).set({ recordedUntil: now, validTo: now }).where(and(
        eq(casCases.id, current.casCaseId as Uuid), eq(casCases.tenantId, tenantId as Uuid), isNull(casCases.recordedUntil),
      ));
      const next = { ...current, ...change };
      await tx.insert(casCases).values({
        versionId: randomUUID(), id: current.casCaseId as Uuid, tenantId: tenantId as Uuid,
        personId: next.personId as Uuid, applicationId: next.applicationId as Uuid | null, enrolmentId: next.enrolmentId as Uuid | null,
        casReference: next.casReference, statusCode: next.statusCode, preparedPayload: next.preparedPayload, preparedBy: next.preparedBy,
        actorId, validFrom: now, recordedAt: now,
      });
    });
  }

  async #personData(tenantId: string, c: CasCaseDto): Promise<Record<string, unknown>> {
    return withTenantContext(this.db, tenantId, async (tx) => {
      const [identity] = await tx.select().from(personIdentities)
        .where(and(eq(personIdentities.tenantId, tenantId as Uuid), eq(personIdentities.personId, c.personId as Uuid), isNull(personIdentities.recordedUntil))).limit(1);
      let course: { programmeId: string | null; modeOfStudyCode: string | null; intakeCode: string | null; startDate: string | null } = { programmeId: null, modeOfStudyCode: null, intakeCode: null, startDate: null };
      if (c.enrolmentId) {
        const [e] = await tx.select().from(enrolments).where(and(eq(enrolments.id, c.enrolmentId as Uuid), isNull(enrolments.recordedUntil))).limit(1);
        if (e) course = { programmeId: e.programmeId, modeOfStudyCode: e.modeOfStudyCode, intakeCode: e.startDate.slice(0, 7), startDate: e.startDate };
      } else if (c.applicationId) {
        const [offer] = await tx.select().from(admissionsOffers)
          .where(and(eq(admissionsOffers.applicationId, c.applicationId as Uuid), inArray(admissionsOffers.statusCode, ['made', 'accepted', 'confirmed'])))
          .orderBy(desc(admissionsOffers.version)).limit(1);
        if (!offer) throw new ConflictError('A CAS needs a current offer to state the course');
        course = { programmeId: offer.programmeId, modeOfStudyCode: offer.modeOfStudyCode, intakeCode: offer.intakeCode, startDate: null };
      }
      const [programme] = course.programmeId ? await tx.select({ code: programmes.code, title: programmes.title }).from(programmes)
        .where(and(eq(programmes.id, course.programmeId as Uuid), isNull(programmes.recordedUntil))).limit(1) : [];
      return {
        personId: c.personId,
        legalFirstName: identity?.legalFirstName ?? null, legalFamilyName: identity?.legalFamilyName ?? null,
        dateOfBirth: identity?.dateOfBirth ?? null, nationalityCode: identity?.nationalityCode ?? null,
        programmeCode: programme?.code ?? null, programmeTitle: programme?.title ?? null,
        modeOfStudyCode: course.modeOfStudyCode, intakeCode: course.intakeCode, startDate: course.startDate,
        ...(c.applicationId ? { applicationId: c.applicationId } : {}), ...(c.enrolmentId ? { enrolmentId: c.enrolmentId } : {}),
      };
    });
  }

  async #approverMustDiffer(tenantId: string): Promise<boolean> {
    const [row] = await this.db.select({ configuration: tenants.configuration }).from(tenants).where(eq(tenants.id, tenantId as Uuid)).limit(1);
    const cas = (row?.configuration?.['cas'] ?? {}) as Record<string, unknown>;
    return cas['approverMustDiffer'] !== false;
  }

  async #publish(type: string, tenantId: string, actorId: string, payload: object): Promise<void> {
    if (!this.eventBus?.isConnected()) return;
    await this.eventBus.publish(type, '1.0.0', tenantId, actorId, 'sensitive', payload as never);
  }

  async #details(tenantId: string, ids: string[]): Promise<CasCaseDetailDto[]> {
    if (ids.length === 0) return [];
    const t = tenantId as Uuid;
    const u = ids as Uuid[];
    const data = await withTenantContext(this.db, tenantId, async (tx) => ({
      cases: await tx.select().from(casCases).where(and(eq(casCases.tenantId, t), inArray(casCases.id, u), isNull(casCases.recordedUntil))),
      firsts: await tx.select({ id: casCases.id, at: sql<Date>`min(${casCases.recordedAt})` }).from(casCases).where(and(eq(casCases.tenantId, t), inArray(casCases.id, u))).groupBy(casCases.id),
      checks: await tx.select().from(casEligibilityChecks).where(and(eq(casEligibilityChecks.tenantId, t), inArray(casEligibilityChecks.casCaseId, u))).orderBy(asc(casEligibilityChecks.checkedAt)),
      versions: await tx.select().from(casAssignmentVersions).where(and(eq(casAssignmentVersions.tenantId, t), inArray(casAssignmentVersions.casCaseId, u))).orderBy(asc(casAssignmentVersions.versionNumber)),
      withdrawnApps: await tx.select({ id: studentApplications.id }).from(studentApplications).innerJoin(casCases, eq(casCases.applicationId, studentApplications.id))
        .where(and(eq(studentApplications.tenantId, t), inArray(casCases.id, u), eq(studentApplications.statusCode, 'withdrawn'))),
    }));
    const withdrawn = new Set(data.withdrawnApps.map((a) => a.id));
    const personIds = [...new Set(data.cases.map((c) => c.personId))] as Uuid[];
    const names = personIds.length ? await withTenantContext(this.db, tenantId, (tx) => tx.select({ personId: personIdentities.personId, first: personIdentities.legalFirstName, family: personIdentities.legalFamilyName })
      .from(personIdentities).where(and(eq(personIdentities.tenantId, t), inArray(personIdentities.personId, personIds), isNull(personIdentities.recordedUntil)))) : [];
    const order = new Map(ids.map((id, i) => [id, i]));
    return data.cases.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0)).map((c) => {
      const name = names.find((n) => n.personId === c.personId);
      const payload = (c.preparedPayload ?? null);
      return {
        ...caseToDto(c),
        openedAt: new Date(data.firsts.find((f) => f.id === c.id)?.at ?? c.recordedAt),
        subject: {
          studentName: name ? `${name.first} ${name.family}` : null,
          programmeCode: (payload?.['programmeCode'] as string | undefined) ?? null, programmeTitle: (payload?.['programmeTitle'] as string | undefined) ?? null,
        },
        eligibilityChecks: data.checks.filter((k) => k.casCaseId === c.id).map((k) => ({
          checkId: k.id, guidanceVersion: k.guidanceVersion, checkTypeCode: k.checkTypeCode, resultCode: k.resultCode, checkedBy: k.checkedBy, checkedAt: k.checkedAt,
        })),
        assignmentVersions: data.versions.filter((v) => v.casCaseId === c.id).map((v) => ({
          assignmentVersionId: v.id, versionNumber: v.versionNumber, assignedPayloadHash: v.assignedPayloadHash, casNumber: v.casNumber,
          approvedBy: v.approvedBy, approvedAt: v.approvedAt, smsRequestSentAt: v.smsRequestSentAt, smsReceiptRef: v.smsReceiptRef,
        })),
        attentionReason: c.applicationId && withdrawn.has(c.applicationId) && (OPEN_CAS_STATUSES.includes(c.statusCode) || c.statusCode === 'assigned')
          ? 'application-withdrawn' : null,
      };
    });
  }
}

function caseToDto(row: CasCase): CasCaseDto {
  return {
    casCaseId: row.id, personId: row.personId, applicationId: row.applicationId, enrolmentId: row.enrolmentId,
    casReference: row.casReference, statusCode: row.statusCode,
    preparedBy: row.preparedBy, preparedPayload: (row.preparedPayload ?? null),
    actorId: row.actorId, validFrom: row.validFrom, validTo: row.validTo, recordedAt: row.recordedAt, recordedUntil: row.recordedUntil,
  };
}
