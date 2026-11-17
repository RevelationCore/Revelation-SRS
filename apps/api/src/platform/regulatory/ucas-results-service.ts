import {
  admissionsOffers,
  conditionEvidence,
  offerConditions,
  studentApplications,
  valueSetMembers,
  valueSets as valueSetTable,
  type Db,
  withTenantContext,
} from '@revelation-srs/db';
import { ConflictError, NotFoundError } from '@revelation-srs/domain';
import { and, desc, eq, inArray } from 'drizzle-orm';

import type { ApplicationService } from '../admissions/application-service.js';
import { clockNow } from '../clock.js';

import { RegulatoryExchangeService } from './exchange-service.js';

type Uuid = `${string}-${string}-${string}-${string}-${string}`;

export const UCAS_RESULTS_CONTRACT = 'ucas-results-inbound.v1';

export interface UcasResultInput {
  ucasPersonalId: string;
  cycle: string;
  awardingBody: string;
  qualificationTypeCode: string;
  subject: string;
  series: string;
  grade: string;
  /** An Awarding Body Linkage result can arrive before results day: it stays embargoed until then. */
  publishedOn?: string;
}

export interface MatchSummary {
  exchangeId: string;
  applicationId: string | null;
  outcome: 'matched' | 'no-application' | 'no-current-offer' | 'no-matching-condition';
  evidence: Array<{ conditionId: string; description: string; matchOutcomeCode: 'meets' | 'below' | 'needs-review' }>;
  embargoedUntil: string | null;
}

/**
 * UCAS results mapped to offer conditions (Phase 3 D-15; BP-01-004). A
 * result is received as an inbound exchange and matched to the applicant's
 * current offer. A condition with structured criteria gets the result as
 * evidence suggesting it meets or falls below them; a free-text condition
 * gets it for review. The result comes from the awarding body through UCAS,
 * so the evidence is verified; the matcher never decides a condition: a
 * holder of offer:decide does, one at a time or by confirming every
 * condition whose evidence all meets.
 */
export class UcasResultsService {
  readonly #exchanges: RegulatoryExchangeService;

  constructor(private readonly db: Db, private readonly applications: ApplicationService, exchanges?: RegulatoryExchangeService) {
    this.#exchanges = exchanges ?? new RegulatoryExchangeService(db);
  }

  async receive(tenantId: string, input: UcasResultInput, actorId: string): Promise<MatchSummary> {
    const key = ['ucas-result', input.ucasPersonalId, input.awardingBody, input.qualificationTypeCode, input.subject, input.series, input.grade].join(':');
    const exchange = await this.#exchanges.recordExchange(tenantId, UCAS_RESULTS_CONTRACT, {
      directionCode: 'inbound', exchangeTypeCode: 'ucas-result', idempotencyKey: key, statusCode: 'received', payloadSummary: { ...input },
    }, actorId);
    const embargoedUntil = input.publishedOn && input.publishedOn > clockNow().toISOString().slice(0, 10) ? input.publishedOn : null;
    const base = { exchangeId: exchange.id, embargoedUntil };

    const ref = `${input.cycle}:${input.ucasPersonalId}`;
    const [app] = await withTenantContext(this.db, tenantId, (tx) => tx.select().from(studentApplications).where(and(
      eq(studentApplications.tenantId, tenantId as Uuid), eq(studentApplications.sourceReference, ref), inArray(studentApplications.channelCode, ['ucas', 'clearing']),
    )).limit(1));
    if (!app) return { ...base, applicationId: null, outcome: 'no-application', evidence: [] };
    const [offer] = await withTenantContext(this.db, tenantId, (tx) => tx.select().from(admissionsOffers).where(and(
      eq(admissionsOffers.applicationId, app.id), inArray(admissionsOffers.statusCode, ['made', 'accepted']),
    )).orderBy(desc(admissionsOffers.version)).limit(1));
    if (!offer) return { ...base, applicationId: app.id, outcome: 'no-current-offer', evidence: [] };

    const conditions = await withTenantContext(this.db, tenantId, (tx) => tx.select().from(offerConditions).where(and(eq(offerConditions.offerId, offer.id), eq(offerConditions.statusCode, 'pending'))));
    const evidence: MatchSummary['evidence'] = [];
    for (const c of conditions) {
      const criteria = c.matchCriteria;
      let outcome: 'meets' | 'below' | 'needs-review' | null = null;
      if (criteria) {
        if (criteria.qualificationTypeCode !== input.qualificationTypeCode) continue;
        if (criteria.subject && criteria.subject.toLowerCase() !== input.subject.toLowerCase()) continue;
        const rank = await this.#ranks(criteria.gradeScale);
        const got = rank.get(input.grade);
        const needed = rank.get(criteria.minimumGrade);
        outcome = got === undefined || needed === undefined ? 'needs-review' : got <= needed ? 'meets' : 'below';
      } else if (c.conditionTypeCode === 'academic') {
        // Free text is never matched: the result is attached for a person to judge.
        outcome = 'needs-review';
      }
      if (!outcome) continue;
      await withTenantContext(this.db, tenantId, (tx) => tx.insert(conditionEvidence).values({
        tenantId: tenantId as Uuid, conditionId: c.id, provenanceCode: 'ucas-results', evidenceRef: `integration-exchange:${exchange.id}`,
        reportedValue: `${input.qualificationTypeCode} ${input.subject} ${input.grade} (${input.awardingBody}, ${input.series})`,
        verified: true, receivedBy: actorId, matchOutcomeCode: outcome, embargoedUntil,
      }));
      evidence.push({ conditionId: c.id, description: c.description, matchOutcomeCode: outcome });
    }
    return { ...base, applicationId: app.id, outcome: evidence.length > 0 ? 'matched' : 'no-matching-condition', evidence };
  }

  /**
   * Confirms as met every pending condition whose evidence all suggests it
   * meets. Each condition still records its own decider and time.
   */
  async confirmSuggestedMet(tenantId: string, offerId: string, actorId: string): Promise<{ confirmed: string[] }> {
    const [offer] = await withTenantContext(this.db, tenantId, (tx) => tx.select().from(admissionsOffers).where(and(eq(admissionsOffers.tenantId, tenantId as Uuid), eq(admissionsOffers.id, offerId as Uuid))).limit(1));
    if (!offer) throw new NotFoundError('Offer', offerId);
    if (!['made', 'accepted'].includes(offer.statusCode)) throw new ConflictError(`Conditions on an offer that is ${offer.statusCode} are frozen`);
    const conditions = await withTenantContext(this.db, tenantId, (tx) => tx.select().from(offerConditions).where(and(eq(offerConditions.offerId, offer.id), eq(offerConditions.statusCode, 'pending'))));
    const today = clockNow().toISOString().slice(0, 10);
    const confirmed: string[] = [];
    for (const c of conditions) {
      const ev = await withTenantContext(this.db, tenantId, (tx) => tx.select().from(conditionEvidence).where(eq(conditionEvidence.conditionId, c.id)));
      const live = ev.filter((e) => !e.embargoedUntil || e.embargoedUntil <= today);
      if (live.length === 0 || !live.every((e) => e.matchOutcomeCode === 'meets' && e.verified)) continue;
      await this.applications.decideCondition(tenantId, c.id, { statusCode: 'met', note: 'Confirmed from matched UCAS results' }, actorId);
      confirmed.push(c.id);
    }
    return { confirmed };
  }

  /** Ranks on a grade scale: lower is better. */
  async #ranks(setCode: string): Promise<Map<string, number>> {
    const rows = await this.db.select({ code: valueSetMembers.code, sortOrder: valueSetMembers.sortOrder }).from(valueSetMembers)
      .innerJoin(valueSetTable, eq(valueSetTable.id, valueSetMembers.valueSetId)).where(eq(valueSetTable.setCode, setCode));
    return new Map(rows.map((r) => [r.code, r.sortOrder]));
  }
}
