import { createHash, randomUUID } from 'node:crypto';

import {
  curriculumPublicationItems,
  curriculumPublications,
  modules,
  programmes,
  type CurriculumPublication,
  type CurriculumPublicationItem,
  type Db,
  type TenantScopedDb,
  withTenantContext,
} from '@revelation-srs/db';
import { ConflictError, NotFoundError } from '@revelation-srs/domain';
import { and, desc, eq, isNull } from 'drizzle-orm';

import { clockNow } from '../clock.js';

type Uuid = `${string}-${string}-${string}-${string}-${string}`;

/** Fields a publication may set; anything else in an item is ignored. */
const PROGRAMME_FIELDS = ['title', 'qualificationTypeCode', 'owningSchool', 'creditFrameworkCode', 'fheqLevel', 'creditTotal', 'durationYears', 'modeOfStudyCode'] as const;
const MODULE_FIELDS = ['title', 'creditValue', 'fheqLevel'] as const;

export interface PublishedProgramme {
  code: string;
  sourceReference?: string;
  closed?: boolean;
  title?: string;
  qualificationTypeCode?: string;
  owningSchool?: string;
  creditFrameworkCode?: string;
  fheqLevel?: number;
  creditTotal?: number;
  durationYears?: number;
  modeOfStudyCode?: string;
}

export interface PublishedModule {
  code: string;
  sourceReference?: string;
  closed?: boolean;
  title?: string;
  creditValue?: number;
  fheqLevel?: number;
}

export interface ReceivePublicationInput {
  sourceSystemCode: string;
  sourcePublicationRef: string;
  publicationVersion: string;
  approvalRef?: string;
  effectiveFrom: string;
  correctionRationale?: string;
  programmes?: PublishedProgramme[];
  modules?: PublishedModule[];
}

export interface PublicationItemDto {
  itemId: string;
  objectTypeCode: string;
  objectCode: string;
  sourceReference: string | null;
  changeTypeCode: string;
  issue: string | null;
  appliedEntityId: string | null;
}

export interface PublicationDto {
  publicationId: string;
  sourceSystemCode: string;
  sourcePublicationRef: string;
  publicationVersion: string;
  approvalRef: string | null;
  effectiveFrom: string;
  statusCode: string;
  counts: { added: number; changed: number; closed: number; unchanged: number; rejected: number };
  receivedBy: string;
  receivedAt: Date;
  appliedBy: string | null;
  appliedAt: Date | null;
  items: PublicationItemDto[];
}

type ItemPlan = {
  objectTypeCode: 'programme' | 'module';
  objectCode: string;
  sourceReference: string | null;
  changeTypeCode: 'add' | 'change' | 'close' | 'unchanged' | 'invalid';
  payload: Record<string, unknown>;
  issue: string | null;
};

/**
 * Receives and applies curriculum publications (BPR-D05; BP-03-001). A
 * publication is one atomic unit: if any item is invalid, nothing is
 * applied; when applied, every version is written in one transaction.
 */
export class CurriculumPublicationService {
  constructor(private readonly db: Db) {}

  async receive(tenantId: string, input: ReceivePublicationInput, actorId: string): Promise<{ publication: PublicationDto; created: boolean }> {
    const payloadHash = createHash('sha256').update(JSON.stringify({
      v: input.publicationVersion, e: input.effectiveFrom, p: input.programmes ?? [], m: input.modules ?? [],
    })).digest('hex');

    const existing = await this.#bySourceRef(tenantId, input.sourceSystemCode, input.sourcePublicationRef);
    if (existing) {
      if (existing.payloadHash !== payloadHash) {
        throw new ConflictError(`Publication ${input.sourcePublicationRef} was already received with different content; send it under a new reference`);
      }
      return { publication: await this.get(tenantId, existing.id), created: false };
    }

    const today = clockNow().toISOString().slice(0, 10);
    const publicationIssues: string[] = [];
    if (input.effectiveFrom < today && !input.correctionRationale) {
      publicationIssues.push('A retrospective publication needs a correction rationale (BP-03-001 E4)');
    }
    if ((input.programmes?.length ?? 0) + (input.modules?.length ?? 0) === 0) {
      publicationIssues.push('A publication must contain at least one programme or module');
    }

    const plans = await withTenantContext(this.db, tenantId, async (tx) => [
      ...(await this.#plan(tx, tenantId, 'programme', input.programmes ?? [], input.effectiveFrom)),
      ...(await this.#plan(tx, tenantId, 'module', input.modules ?? [], input.effectiveFrom)),
    ]);

    const invalid = plans.filter((p) => p.changeTypeCode === 'invalid').length;
    const rejected = invalid > 0 || publicationIssues.length > 0;
    const count = (type: ItemPlan['changeTypeCode']) => plans.filter((p) => p.changeTypeCode === type).length;
    const id = randomUUID();

    await withTenantContext(this.db, tenantId, async (tx) => {
      await tx.insert(curriculumPublications).values({
        id: id,
        tenantId: tenantId as Uuid,
        sourceSystemCode: input.sourceSystemCode,
        sourcePublicationRef: input.sourcePublicationRef,
        publicationVersion: input.publicationVersion,
        approvalRef: input.approvalRef ?? null,
        effectiveFrom: input.effectiveFrom,
        correctionRationale: input.correctionRationale ?? null,
        statusCode: rejected ? 'rejected' : 'validated',
        addedCount: count('add'),
        changedCount: count('change'),
        closedCount: count('close'),
        unchangedCount: count('unchanged'),
        rejectedCount: invalid,
        payloadHash,
        receivedBy: actorId,
      });
      const rows = [
        ...publicationIssues.map((issue): ItemPlan => ({ objectTypeCode: 'programme', objectCode: '(publication)', sourceReference: null, changeTypeCode: 'invalid', payload: {}, issue })),
        ...plans,
      ];
      if (rows.length > 0) {
        await tx.insert(curriculumPublicationItems).values(rows.map((p) => ({
          tenantId: tenantId as Uuid, publicationId: id, objectTypeCode: p.objectTypeCode, objectCode: p.objectCode,
          sourceReference: p.sourceReference, changeTypeCode: p.changeTypeCode, payload: p.payload, issue: p.issue,
        })));
      }
    });
    return { publication: await this.get(tenantId, id), created: true };
  }

  /**
   * Applies a validated publication in one transaction. Refused if the
   * catalogue has changed since the publication was classified, so a
   * change is never written over a version it was not compared with.
   */
  async apply(tenantId: string, publicationId: string, actorId: string): Promise<PublicationDto> {
    const publication = await this.#row(tenantId, publicationId);
    if (!publication) throw new NotFoundError('CurriculumPublication', publicationId);
    if (publication.statusCode === 'applied') return this.get(tenantId, publicationId);
    if (publication.statusCode !== 'validated') {
      throw new ConflictError('Only a validated publication can be applied; this one was rejected');
    }
    // A publication someone entered by hand is applied by someone else; one sent by
    // the curriculum connector carries the source system's approval (D-7).
    if (publication.receivedBy === actorId) {
      throw new ConflictError('You received this publication, so someone else must apply it');
    }

    const validFrom = new Date(`${publication.effectiveFrom}T00:00:00Z`);
    const now = clockNow();

    await withTenantContext(this.db, tenantId, async (tx) => {
      const items = await tx.select().from(curriculumPublicationItems).where(and(
        eq(curriculumPublicationItems.tenantId, tenantId as Uuid),
        eq(curriculumPublicationItems.publicationId, publication.id),
      ));
      for (const item of items) {
        if (item.changeTypeCode === 'unchanged' || item.changeTypeCode === 'invalid') continue;
        const table = item.objectTypeCode === 'programme' ? programmes : modules;
        const current = await this.#current(tx, tenantId, item.objectTypeCode as 'programme' | 'module', item.objectCode);
        const base = (item.payload['_baseVersionId'] as string | undefined) ?? null;
        if ((current?.versionId ?? null) !== base) {
          throw new ConflictError(`${item.objectTypeCode} ${item.objectCode} changed after this publication was received; send a new publication`);
        }

        const fields = pick(item.payload, item.objectTypeCode === 'programme' ? PROGRAMME_FIELDS : MODULE_FIELDS);
        if (item.changeTypeCode === 'add') {
          const entityId = randomUUID();
          await tx.insert(table).values({
            id: entityId, tenantId: tenantId as Uuid, code: item.objectCode, title: String(fields['title']),
            ...fields, sourceSystemReference: item.sourceReference, validFrom, validTo: null, recordedAt: now, recordedUntil: null,
          } as never);
          await tx.update(curriculumPublicationItems).set({ appliedEntityId: entityId }).where(eq(curriculumPublicationItems.id, item.id));
          continue;
        }

        // change or close: close-and-replace the current version.
        const row = current!;
        await tx.update(table).set({ recordedUntil: now, validTo: validFrom }).where(eq(table.versionId, row.versionId));
        const { versionId: _v, recordedAt: _a, recordedUntil: _u, validFrom: _f, validTo: _t, ...carried } = row;
        await tx.insert(table).values({
          ...carried,
          ...(item.changeTypeCode === 'change' ? fields : {}),
          ...(item.sourceReference ? { sourceSystemReference: item.sourceReference } : {}),
          versionId: randomUUID(),
          // A closure keeps the record up to the effective date and ends it there.
          validFrom: item.changeTypeCode === 'close' ? row.validFrom : validFrom,
          validTo: item.changeTypeCode === 'close' ? validFrom : null,
          recordedAt: now,
          recordedUntil: null,
        } as never);
        await tx.update(curriculumPublicationItems).set({ appliedEntityId: row.id }).where(eq(curriculumPublicationItems.id, item.id));
      }
      await tx.update(curriculumPublications).set({ statusCode: 'applied', appliedBy: actorId, appliedAt: now })
        .where(eq(curriculumPublications.id, publication.id));
    });
    return this.get(tenantId, publicationId);
  }

  async get(tenantId: string, publicationId: string): Promise<PublicationDto> {
    const row = await this.#row(tenantId, publicationId);
    if (!row) throw new NotFoundError('CurriculumPublication', publicationId);
    const items = await withTenantContext(this.db, tenantId, (tx) => tx.select().from(curriculumPublicationItems)
      .where(and(eq(curriculumPublicationItems.tenantId, tenantId as Uuid), eq(curriculumPublicationItems.publicationId, row.id))));
    return publicationDto(row, items);
  }

  async list(tenantId: string): Promise<PublicationDto[]> {
    const rows = await withTenantContext(this.db, tenantId, (tx) => tx.select().from(curriculumPublications)
      .where(eq(curriculumPublications.tenantId, tenantId as Uuid)).orderBy(desc(curriculumPublications.receivedAt)).limit(100));
    return rows.map((r) => publicationDto(r, []));
  }

  async #plan(
    tx: TenantScopedDb,
    tenantId: string,
    type: 'programme' | 'module',
    items: Array<PublishedProgramme | PublishedModule>,
    effectiveFrom: string,
  ): Promise<ItemPlan[]> {
    const seen = new Set<string>();
    const fields = type === 'programme' ? PROGRAMME_FIELDS : MODULE_FIELDS;
    const plans: ItemPlan[] = [];
    for (const item of items) {
      const record = item as unknown as Record<string, unknown>;
      const code = (item.code ?? '').trim();
      const base = { objectTypeCode: type, objectCode: code || '(missing code)', sourceReference: item.sourceReference ?? null } as const;
      const invalid = (issue: string): ItemPlan => ({ ...base, changeTypeCode: 'invalid', payload: { ...item }, issue });
      if (!code) { plans.push(invalid('Missing code')); continue; }
      if (seen.has(code)) { plans.push(invalid(`${type} ${code} appears twice in this publication`)); continue; }
      seen.add(code);
      const level = (item as { fheqLevel?: number }).fheqLevel;
      if (level !== undefined && (level < 3 || level > 8)) { plans.push(invalid('FHEQ level must be between 3 and 8')); continue; }
      const credit = (item as { creditValue?: number; creditTotal?: number }).creditValue ?? (item as { creditTotal?: number }).creditTotal;
      if (credit !== undefined && (!Number.isInteger(credit) || credit <= 0)) { plans.push(invalid('Credit must be a positive whole number')); continue; }

      const current = await this.#current(tx, tenantId, type, code);
      if (current && current.validFrom.toISOString().slice(0, 10) >= effectiveFrom) {
        plans.push(invalid(`The current ${type} version is effective from ${current.validFrom.toISOString().slice(0, 10)}; this publication would overlap it`));
        continue;
      }
      const payload = { ...pick(record, fields), _baseVersionId: current?.versionId ?? null };
      if (item.closed) {
        plans.push(current ? { ...base, changeTypeCode: 'close', payload, issue: null } : invalid(`${type} ${code} is not in the catalogue, so it cannot be closed`));
        continue;
      }
      if (!current) {
        plans.push(item.title ? { ...base, changeTypeCode: 'add', payload, issue: null } : invalid('A new item needs a title'));
        continue;
      }
      const differs = fields.some((f) => record[f] !== undefined
        && record[f] !== (current as unknown as Record<string, unknown>)[f]);
      plans.push({ ...base, changeTypeCode: differs ? 'change' : 'unchanged', payload, issue: null });
    }
    return plans;
  }

  async #current(tx: TenantScopedDb, tenantId: string, type: 'programme' | 'module', code: string) {
    const table = type === 'programme' ? programmes : modules;
    const rows = await tx.select().from(table).where(and(
      eq(table.tenantId, tenantId as Uuid), eq(table.code, code), isNull(table.recordedUntil), isNull(table.validTo),
    )).limit(1);
    return rows[0] ?? null;
  }

  async #row(tenantId: string, id: string): Promise<CurriculumPublication | null> {
    const rows = await withTenantContext(this.db, tenantId, (tx) => tx.select().from(curriculumPublications)
      .where(and(eq(curriculumPublications.id, id as Uuid), eq(curriculumPublications.tenantId, tenantId as Uuid))).limit(1));
    return rows[0] ?? null;
  }

  async #bySourceRef(tenantId: string, source: string, ref: string): Promise<CurriculumPublication | null> {
    const rows = await withTenantContext(this.db, tenantId, (tx) => tx.select().from(curriculumPublications).where(and(
      eq(curriculumPublications.tenantId, tenantId as Uuid),
      eq(curriculumPublications.sourceSystemCode, source),
      eq(curriculumPublications.sourcePublicationRef, ref),
    )).limit(1));
    return rows[0] ?? null;
  }
}

function pick(source: Record<string, unknown>, fields: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(fields.filter((f) => source[f] !== undefined).map((f) => [f, source[f]]));
}

function publicationDto(row: CurriculumPublication, items: CurriculumPublicationItem[]): PublicationDto {
  return {
    publicationId: row.id,
    sourceSystemCode: row.sourceSystemCode,
    sourcePublicationRef: row.sourcePublicationRef,
    publicationVersion: row.publicationVersion,
    approvalRef: row.approvalRef,
    effectiveFrom: row.effectiveFrom,
    statusCode: row.statusCode,
    counts: { added: row.addedCount, changed: row.changedCount, closed: row.closedCount, unchanged: row.unchangedCount, rejected: row.rejectedCount },
    receivedBy: row.receivedBy,
    receivedAt: row.receivedAt,
    appliedBy: row.appliedBy,
    appliedAt: row.appliedAt,
    items: items.map((i) => ({
      itemId: i.id, objectTypeCode: i.objectTypeCode, objectCode: i.objectCode, sourceReference: i.sourceReference,
      changeTypeCode: i.changeTypeCode, issue: i.issue, appliedEntityId: i.appliedEntityId,
    })),
  };
}
