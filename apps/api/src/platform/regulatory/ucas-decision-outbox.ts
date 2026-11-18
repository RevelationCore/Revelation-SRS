import { createHash } from 'node:crypto';

import {
  integrationExchanges,
  tenants,
  valueSetMembers,
  valueSets as valueSetTable,
  type Db,
  type IntegrationExchange,
  type TenantScopedDb,
  withTenantContext,
} from '@revelation-srs/db';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';

import { clockNow } from '../clock.js';
import { addWorkingDaysFor } from '../calendar/working-days.js';

import { RegulatoryExchangeService } from './exchange-service.js';

type Uuid = `${string}-${string}-${string}-${string}-${string}`;

export const UCAS_DECISION_CONTRACT = 'ucas-admissions-exchange.{cycle}';
export type UcasOutcome = 'offer-conditional' | 'offer-unconditional' | 'reject' | 'withdraw' | 'confirmed' | 'confirmed-alternative' | 'unsuccessful';

export interface QueueDecisionInput {
  applicationId: string;
  ucasApplicationId: string;
  sourceReference: string;
  cycle: string;
  outcome: UcasOutcome;
  /** The authoritative row: an offer version, a confirmation decision, or the application. */
  idempotencyKey: string;
  detail: Record<string, unknown>;
}

export interface UcasOutboundItem {
  exchangeId: string; applicationId: string; sourceReference: string; outcome: string; ucasCode: string | null;
  statusCode: string; queuedAt: Date; sentAt: Date | null; attention: 'not-reconciled' | 'mismatch' | null;
}

export interface UcasDecisionFile {
  contract: 'ucas/decisions-outbound.v1';
  generatedAt: string;
  transport: 'manual-file' | 'simulator';
  processedCount: number;
  decisions: Array<{ exchangeId: string; sourceReference: string; cycle: string; outcome: string; ucasCode: string | null; detail: Record<string, unknown> }>;
}

/**
 * UCAS outbound decisions (Phase 3 D-14, D-15). A decision on a UCAS-channel
 * application queues an outbound exchange in the same transaction (an
 * outbox), keyed by the row that is authoritative for it; a later decision
 * supersedes a queued one that has not gone. The tenant's transport sends
 * queued items: a manual file by default, or the in-repo simulator. An
 * inbound UCAS status that agrees reconciles a sent item; a contradiction is
 * a mismatch, and an item not reconciled within the working-day limit needs
 * attention. Transport delivery alone is never "applied".
 */
export class UcasDecisionOutbox {
  readonly #exchanges: RegulatoryExchangeService;

  constructor(private readonly db: Db, exchanges?: RegulatoryExchangeService) {
    this.#exchanges = exchanges ?? new RegulatoryExchangeService(db);
  }

  /** The ledger registration, fetched before the decision's transaction opens. */
  async registration(tenantId: string, actorId: string): Promise<string> {
    return (await this.#exchanges.ensureRegistration(tenantId, UCAS_DECISION_CONTRACT, actorId, 'manual-file')).id;
  }

  /** Queues a decision inside the caller's transaction, superseding a queued item for the same application. */
  async queue(tx: TenantScopedDb, tenantId: string, registrationId: string, input: QueueDecisionInput): Promise<void> {
    const t = tenantId as Uuid;
    await tx.update(integrationExchanges).set({ statusCode: 'superseded' }).where(and(
      eq(integrationExchanges.tenantId, t), eq(integrationExchanges.contractId, UCAS_DECISION_CONTRACT), eq(integrationExchanges.statusCode, 'queued'),
      sql`${integrationExchanges.payloadSummary}->>'applicationId' = ${input.applicationId}`,
    ));
    const summary = { applicationId: input.applicationId, ucasApplicationId: input.ucasApplicationId, sourceReference: input.sourceReference, cycle: input.cycle, outcome: input.outcome, detail: input.detail };
    await tx.insert(integrationExchanges).values({
      tenantId: t, integrationRegistrationId: registrationId as Uuid, contractId: UCAS_DECISION_CONTRACT, directionCode: 'outbound',
      exchangeTypeCode: 'ucas-decision', idempotencyKey: input.idempotencyKey, statusCode: 'queued', attemptCount: 0,
      payloadHash: createHash('sha256').update(JSON.stringify(summary)).digest('hex'), payloadSummary: summary, sentAt: null,
    }).onConflictDoNothing();
  }

  /** Sends every queued decision through the tenant's transport. */
  async dispatch(tenantId: string, actorId: string, simulator?: (tenantId: string, file: UcasDecisionFile) => Promise<void>): Promise<UcasDecisionFile> {
    const transport = await this.#transport(tenantId);
    const crosswalk = await this.#crosswalk();
    const queued = await withTenantContext(this.db, tenantId, (tx) => tx.select().from(integrationExchanges).where(and(
      eq(integrationExchanges.tenantId, tenantId as Uuid), eq(integrationExchanges.contractId, UCAS_DECISION_CONTRACT), eq(integrationExchanges.statusCode, 'queued'),
    )).orderBy(asc(integrationExchanges.createdAt)));
    const now = clockNow();
    const file: UcasDecisionFile = {
      contract: 'ucas/decisions-outbound.v1', generatedAt: now.toISOString(), transport, processedCount: queued.length,
      decisions: queued.map((q) => {
        const s = q.payloadSummary as Record<string, unknown>;
        return { exchangeId: q.id, sourceReference: String(s['sourceReference']), cycle: String(s['cycle']), outcome: String(s['outcome']), ucasCode: crosswalk.get(String(s['outcome']))?.ucasCode ?? null, detail: (s['detail'] ?? {}) as Record<string, unknown> };
      }),
    };
    if (queued.length > 0) {
      await withTenantContext(this.db, tenantId, (tx) => tx.update(integrationExchanges).set({ statusCode: 'sent', sentAt: now, attemptCount: sql`${integrationExchanges.attemptCount} + 1`, lastAttemptAt: now })
        .where(inArray(integrationExchanges.id, queued.map((q) => q.id))));
    }
    if (transport === 'simulator' && simulator) await simulator(tenantId, file);
    void actorId;
    return file;
  }

  /** An inbound UCAS status for an application reconciles or contradicts what was sent for it. */
  async reconcile(tenantId: string, applicationId: string, inboundStatus: string): Promise<{ reconciled: number; mismatched: number }> {
    const crosswalk = await this.#crosswalk();
    const sent = await withTenantContext(this.db, tenantId, (tx) => tx.select().from(integrationExchanges).where(and(
      eq(integrationExchanges.tenantId, tenantId as Uuid), eq(integrationExchanges.contractId, UCAS_DECISION_CONTRACT), eq(integrationExchanges.statusCode, 'sent'),
      sql`${integrationExchanges.payloadSummary}->>'applicationId' = ${applicationId}`,
    )));
    let reconciled = 0;
    let mismatched = 0;
    for (const item of sent) {
      const outcome = String((item.payloadSummary as Record<string, unknown>)['outcome']);
      const agrees = crosswalk.get(outcome)?.reconcilesWith.includes(inboundStatus) ?? false;
      // A status that a different outcome would produce contradicts it; an unrelated one ('received') says nothing.
      const contradicts = !agrees && [...crosswalk.values()].some((c) => c.reconcilesWith.includes(inboundStatus));
      if (!agrees && !contradicts) continue;
      await withTenantContext(this.db, tenantId, (tx) => tx.update(integrationExchanges).set({
        statusCode: agrees ? 'reconciled' : 'mismatch', ...(agrees ? {} : { lastError: `UCAS reports '${inboundStatus}' after '${outcome}' was sent` }),
      }).where(eq(integrationExchanges.id, item.id)));
      if (agrees) reconciled += 1; else mismatched += 1;
    }
    return { reconciled, mismatched };
  }

  /** The integration worklist: what is queued, sent and waiting, and what needs attention. */
  async list(tenantId: string, opts: { attentionOnly?: boolean } = {}): Promise<UcasOutboundItem[]> {
    const limit = await this.#workingDays(tenantId);
    const crosswalk = await this.#crosswalk();
    const rows = await withTenantContext(this.db, tenantId, (tx) => tx.select().from(integrationExchanges).where(and(
      eq(integrationExchanges.tenantId, tenantId as Uuid), eq(integrationExchanges.contractId, UCAS_DECISION_CONTRACT),
      inArray(integrationExchanges.statusCode, ['queued', 'sent', 'mismatch', 'reconciled']),
    )).orderBy(asc(integrationExchanges.createdAt)));
    const now = clockNow();
    const items: UcasOutboundItem[] = [];
    for (const r of rows as IntegrationExchange[]) items.push(await (async (): Promise<UcasOutboundItem> => {
      const s = r.payloadSummary as Record<string, unknown>;
      const overdue = r.statusCode === 'sent' && r.sentAt !== null && (await addWorkingDaysFor(this.db, tenantId, r.sentAt, limit)) < now;
      return {
        exchangeId: r.id, applicationId: String(s['applicationId']), sourceReference: String(s['sourceReference']), outcome: String(s['outcome']),
        ucasCode: crosswalk.get(String(s['outcome']))?.ucasCode ?? null, statusCode: r.statusCode, queuedAt: r.createdAt, sentAt: r.sentAt,
        attention: r.statusCode === 'mismatch' ? 'mismatch' : overdue ? 'not-reconciled' : null,
      };
    })());
    return opts.attentionOnly ? items.filter((i) => i.attention) : items;
  }

  async #crosswalk(): Promise<Map<string, { ucasCode: string | null; reconcilesWith: string[] }>> {
    const rows = await this.db.select({ code: valueSetMembers.code, meta: valueSetMembers.sourceMetadata }).from(valueSetMembers)
      .innerJoin(valueSetTable, eq(valueSetTable.id, valueSetMembers.valueSetId)).where(eq(valueSetTable.setCode, 'ucas-decision-crosswalk'));
    return new Map(rows.map((r) => {
      const m = (r.meta ?? {}) as { ucasCode?: string; reconcilesWith?: string[] };
      return [r.code, { ucasCode: m.ucasCode ?? null, reconcilesWith: m.reconcilesWith ?? [] }];
    }));
  }

  async #settings(tenantId: string): Promise<Record<string, unknown>> {
    const [row] = await this.db.select({ configuration: tenants.configuration }).from(tenants).where(eq(tenants.id, tenantId as Uuid)).limit(1);
    return ((row?.configuration?.['ucas'] ?? {}) as Record<string, unknown>);
  }

  async #transport(tenantId: string): Promise<'manual-file' | 'simulator'> {
    const outbound = ((await this.#settings(tenantId))['outbound'] ?? {}) as Record<string, unknown>;
    return outbound['transport'] === 'simulator' ? 'simulator' : 'manual-file';
  }

  async #workingDays(tenantId: string): Promise<number> {
    const r = ((await this.#settings(tenantId))['reconciliation'] ?? {}) as Record<string, unknown>;
    return typeof r['workingDays'] === 'number' && r['workingDays'] > 0 ? r['workingDays'] : 2;
  }
}
