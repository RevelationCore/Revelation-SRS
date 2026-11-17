import { createHash, randomUUID } from 'node:crypto';

import {
  academicPeriods,
  curriculumPublicationItems,
  curriculumPublications,
  enrolmentCurriculumBindings,
  learningOutcomes,
  moduleGroupMembers,
  moduleGroups,
  moduleOfferings,
  moduleRegistrations,
  modules,
  programmeRoutes,
  programmeRuleSets,
  programmes,
  tenants,
  type CurriculumPublication,
  type CurriculumPublicationItem,
  type Db,
  type TenantScopedDb,
  withTenantContext,
} from '@revelation-srs/db';
import { ConflictError, ForbiddenError, NotFoundError } from '@revelation-srs/domain';
import { and, desc, eq, gte, isNull, ne, sql } from 'drizzle-orm';

import { clockNow } from '../clock.js';

type Uuid = `${string}-${string}-${string}-${string}-${string}`;

/** Fields a publication may set; anything else in an item is ignored. */
const PROGRAMME_FIELDS = ['title', 'qualificationTypeCode', 'owningSchool', 'creditFrameworkCode', 'fheqLevel', 'creditTotal', 'durationYears', 'modeOfStudyCode'] as const;
const MODULE_FIELDS = ['title', 'creditValue', 'fheqLevel'] as const;
const ROUTE_FIELDS = ['title'] as const;
const RULE_SET_FIELDS = ['description', 'entryAcademicYear'] as const;
const GROUP_FIELDS = ['title', 'groupTypeCode', 'fheqLevel', 'minModules', 'maxModules', 'minCredits', 'maxCredits', 'minFheqLevel', 'maxFheqLevel'] as const;
const MEMBER_FIELDS = ['isDefault', 'isNonCondonable'] as const;
const OUTCOME_FIELDS = ['description'] as const;
const OFFERING_FIELDS = ['deliveryModeCode', 'capacity'] as const;

/** Apply order: an item may depend only on types before it (D-22). */
export const OBJECT_TYPES = ['programme', 'module', 'route', 'rule-set', 'module-group', 'module-group-member', 'learning-outcome', 'module-offering'] as const;
export type ObjectType = (typeof OBJECT_TYPES)[number];

export interface PublishedProgramme { code: string; sourceReference?: string; closed?: boolean; title?: string; qualificationTypeCode?: string; owningSchool?: string; creditFrameworkCode?: string; fheqLevel?: number; creditTotal?: number; durationYears?: number; modeOfStudyCode?: string }
export interface PublishedModule { code: string; sourceReference?: string; closed?: boolean; title?: string; creditValue?: number; fheqLevel?: number }
export interface PublishedRoute { programmeCode: string; routeCode: string; sourceReference?: string; closed?: boolean; title?: string }
export interface PublishedGroupMember { moduleCode: string; closed?: boolean; isDefault?: boolean; isNonCondonable?: boolean }
export interface PublishedGroup {
  groupCode: string; closed?: boolean; title?: string; groupTypeCode?: 'compulsory' | 'optional-pool' | 'elective-pool'; fheqLevel?: number;
  minModules?: number; maxModules?: number; minCredits?: number; maxCredits?: number; minFheqLevel?: number; maxFheqLevel?: number;
  members?: PublishedGroupMember[];
}
export interface PublishedRuleSet {
  programmeCode: string; ruleSetCode: string; routeCode?: string; entryAcademicYear?: string; description?: string;
  sourceReference?: string; closed?: boolean; groups?: PublishedGroup[];
}
export interface PublishedLearningOutcome { ownerType: 'programme' | 'module'; ownerCode: string; outcomeCode: string; description?: string; sourceReference?: string; closed?: boolean }
export interface PublishedOffering { moduleCode: string; academicYear: string; periodCode: string; deliveryModeCode?: string; capacity?: number; sourceReference?: string; closed?: boolean }

export interface ReceivePublicationInput {
  sourceSystemCode: string;
  sourcePublicationRef: string;
  publicationVersion: string;
  approvalRef?: string;
  effectiveFrom: string;
  correctionRationale?: string;
  programmes?: PublishedProgramme[];
  modules?: PublishedModule[];
  routes?: PublishedRoute[];
  ruleSets?: PublishedRuleSet[];
  learningOutcomes?: PublishedLearningOutcome[];
  offerings?: PublishedOffering[];
}

export interface PublicationItemDto {
  itemId: string;
  objectTypeCode: string;
  objectCode: string;
  sourceReference: string | null;
  changeTypeCode: string;
  issue: string | null;
  appliedEntityId: string | null;
  /** Students bound to (or registered on) what this item changes (D-22). */
  affectsStudents: number;
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
  /** Applying needs curriculum-binding:approve when any item affects students (D-22). */
  affectsStudents: number;
  receivedBy: string;
  receivedAt: Date;
  appliedBy: string | null;
  appliedAt: Date | null;
  items: PublicationItemDto[];
}

type ChangeType = 'add' | 'change' | 'close' | 'unchanged' | 'invalid';
type ItemPlan = {
  objectTypeCode: ObjectType;
  objectCode: string;
  sourceReference: string | null;
  changeTypeCode: ChangeType;
  payload: Record<string, unknown>;
  issue: string | null;
};

/** One normalised item: its type, key, the fields it sets and what it depends on. */
interface Candidate {
  type: ObjectType;
  code: string;
  sourceReference: string | null;
  closed: boolean;
  record: Record<string, unknown>;
  keys: Record<string, string | undefined>;
}

const FIELDS: Record<ObjectType, readonly string[]> = {
  programme: PROGRAMME_FIELDS, module: MODULE_FIELDS, route: ROUTE_FIELDS, 'rule-set': RULE_SET_FIELDS,
  'module-group': GROUP_FIELDS, 'module-group-member': MEMBER_FIELDS, 'learning-outcome': OUTCOME_FIELDS, 'module-offering': OFFERING_FIELDS,
};

/**
 * Receives and applies curriculum publications (BPR-D05; BP-03-001; Phase 3
 * D-22). A publication is one atomic unit across programmes, modules, routes,
 * rule sets (with their groups and members), learning outcomes and module
 * offerings: if any item is invalid nothing is applied; when applied, items
 * are written in dependency order in one transaction. What students are bound
 * to or registered on is protected: closing it is refused, and changing it
 * needs a correction rationale and a curriculum-binding approver to apply.
 */
export class CurriculumPublicationService {
  constructor(private readonly db: Db) {}

  async receive(tenantId: string, input: ReceivePublicationInput, actorId: string): Promise<{ publication: PublicationDto; created: boolean }> {
    const payloadHash = createHash('sha256').update(JSON.stringify({
      v: input.publicationVersion, e: input.effectiveFrom, p: input.programmes ?? [], m: input.modules ?? [],
      ...(input.routes?.length ? { r: input.routes } : {}), ...(input.ruleSets?.length ? { s: input.ruleSets } : {}),
      ...(input.learningOutcomes?.length ? { o: input.learningOutcomes } : {}), ...(input.offerings?.length ? { f: input.offerings } : {}),
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
    const candidates = flatten(input);
    if (candidates.length === 0) publicationIssues.push('A publication must contain at least one item');

    const plans = await withTenantContext(this.db, tenantId, (tx) => this.#plan(tx, tenantId, candidates, input));

    const invalid = plans.filter((p) => p.changeTypeCode === 'invalid').length;
    const rejected = invalid > 0 || publicationIssues.length > 0;
    const count = (type: ChangeType) => plans.filter((p) => p.changeTypeCode === type).length;
    const id = randomUUID();

    await withTenantContext(this.db, tenantId, async (tx) => {
      await tx.insert(curriculumPublications).values({
        id, tenantId: tenantId as Uuid, sourceSystemCode: input.sourceSystemCode, sourcePublicationRef: input.sourcePublicationRef,
        publicationVersion: input.publicationVersion, approvalRef: input.approvalRef ?? null, effectiveFrom: input.effectiveFrom,
        correctionRationale: input.correctionRationale ?? null, statusCode: rejected ? 'rejected' : 'validated',
        addedCount: count('add'), changedCount: count('change'), closedCount: count('close'), unchangedCount: count('unchanged'), rejectedCount: invalid,
        payloadHash, receivedBy: actorId,
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
   * Applies a validated publication in one transaction, in dependency order.
   * Refused if the catalogue changed since the publication was classified,
   * and, when it affects students, unless the applier may approve binding
   * changes (D-22, D-11).
   */
  async apply(tenantId: string, publicationId: string, actorId: string, opts: { canApproveBindingChanges?: boolean } = {}): Promise<PublicationDto> {
    const publication = await this.#row(tenantId, publicationId);
    if (!publication) throw new NotFoundError('CurriculumPublication', publicationId);
    if (publication.statusCode === 'applied') return this.get(tenantId, publicationId);
    if (publication.statusCode !== 'validated') throw new ConflictError('Only a validated publication can be applied; this one was rejected');
    // A publication someone entered by hand is applied by someone else; one sent by
    // the curriculum connector carries the source system's approval (D-7).
    if (publication.receivedBy === actorId) throw new ConflictError('You received this publication, so someone else must apply it');
    const dto = await this.get(tenantId, publicationId);
    if (dto.affectsStudents > 0 && !opts.canApproveBindingChanges) {
      throw new ForbiddenError(`This publication changes what ${dto.affectsStudents} student(s) are bound to or registered on: a curriculum-binding approver must apply it`);
    }

    const validFrom = new Date(`${publication.effectiveFrom}T00:00:00Z`);
    const now = clockNow();

    await withTenantContext(this.db, tenantId, async (tx) => {
      const items = (await tx.select().from(curriculumPublicationItems).where(and(
        eq(curriculumPublicationItems.tenantId, tenantId as Uuid), eq(curriculumPublicationItems.publicationId, publication.id),
      ))).sort((a, b) => OBJECT_TYPES.indexOf(a.objectTypeCode as ObjectType) - OBJECT_TYPES.indexOf(b.objectTypeCode as ObjectType));
      for (const item of items) {
        if (item.changeTypeCode === 'unchanged' || item.changeTypeCode === 'invalid') continue;
        const type = item.objectTypeCode as ObjectType;
        const keys = (item.payload['_keys'] ?? {}) as Record<string, string | undefined>;
        const current = await this.#current(tx, tenantId, type, keys);
        const base = (item.payload['_baseVersionId'] as string | undefined) ?? null;
        if (((current as { versionId?: string } | null)?.versionId ?? (current as { id?: string } | null)?.id ?? null) !== base) {
          throw new ConflictError(`${type} ${item.objectCode} changed after this publication was received; send a new publication`);
        }
        const fields = pick(item.payload, FIELDS[type]);
        const entityId = await this.#write(tx, tenantId, type, item.changeTypeCode as 'add' | 'change' | 'close', keys, fields, current, item.sourceReference, validFrom, now);
        await tx.update(curriculumPublicationItems).set({ appliedEntityId: entityId }).where(eq(curriculumPublicationItems.id, item.id));
      }
      await tx.update(curriculumPublications).set({ statusCode: 'applied', appliedBy: actorId, appliedAt: now }).where(eq(curriculumPublications.id, publication.id));
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

  /** The master for each object type (D-22 rule 5): the SRS, or the curriculum system. */
  async masteredBy(tenantId: string, type: ObjectType): Promise<'srs' | 'curriculum-system'> {
    const [row] = await this.db.select({ configuration: tenants.configuration }).from(tenants).where(eq(tenants.id, tenantId as Uuid)).limit(1);
    const curriculum = (row?.configuration?.['curriculum'] ?? {}) as Record<string, unknown>;
    const masters = (curriculum['masteredBy'] ?? {}) as Record<string, unknown>;
    return masters[type] === 'curriculum-system' ? 'curriculum-system' : 'srs';
  }

  // ── classification ────────────────────────────────────────────────────────

  async #plan(tx: TenantScopedDb, tenantId: string, candidates: Candidate[], input: ReceivePublicationInput): Promise<ItemPlan[]> {
    const seen = new Set<string>();
    // What the publication itself provides, for references to resolve against first.
    const provided = new Map(candidates.map((c) => [`${c.type}:${c.code}`, c]));
    const plans: ItemPlan[] = [];
    for (const c of candidates) {
      const base = { objectTypeCode: c.type, objectCode: c.code, sourceReference: c.sourceReference } as const;
      const invalid = (issue: string): ItemPlan => ({ ...base, changeTypeCode: 'invalid', payload: { ...c.record, _keys: c.keys }, issue });
      if (!c.code || c.code.includes('undefined')) { plans.push(invalid('Missing code')); continue; }
      const id = `${c.type}:${c.code}`;
      if (seen.has(id)) { plans.push(invalid(`${c.type} ${c.code} appears twice in this publication`)); continue; }
      seen.add(id);
      const fieldIssue = validateFields(c);
      if (fieldIssue) { plans.push(invalid(fieldIssue)); continue; }

      // References resolve to this publication first, then to the catalogue (D-22 ordering).
      const refIssue = await this.#references(tx, tenantId, c, provided);
      if (refIssue) { plans.push(invalid(refIssue)); continue; }

      const current = await this.#current(tx, tenantId, c.type, c.keys);
      const bitemporal = c.type !== 'module-offering';
      const currentFrom = bitemporal ? (current as { validFrom?: Date } | null)?.validFrom?.toISOString().slice(0, 10) : undefined;
      if (currentFrom && currentFrom >= input.effectiveFrom) {
        plans.push(invalid(`The current ${c.type} version is effective from ${currentFrom}; this publication would overlap it`));
        continue;
      }
      const baseVersion = (current as { versionId?: string } | null)?.versionId ?? (current as { id?: string } | null)?.id ?? null;
      const payload: Record<string, unknown> = { ...pick(c.record, FIELDS[c.type]), _keys: c.keys, _baseVersionId: baseVersion };

      let change: ChangeType;
      if (c.closed) {
        if (!current) { plans.push(invalid(`${c.type} ${c.code} is not in the catalogue, so it cannot be closed`)); continue; }
        change = 'close';
      } else if (!current) {
        const missing = requiredForAdd(c);
        if (missing) { plans.push(invalid(missing)); continue; }
        change = 'add';
      } else {
        const differs = FIELDS[c.type].some((f) => c.record[f] !== undefined && c.record[f] !== (current)[f]);
        change = differs ? 'change' : 'unchanged';
      }

      // Protection (D-22 rule 2): what students are bound to or registered on.
      if (change !== 'unchanged') {
        const affected = await this.#affected(tx, tenantId, c, current, change);
        if (affected > 0) {
          if (change === 'close') { plans.push(invalid(`${affected} student(s) are bound to or registered on ${c.type} ${c.code}; it cannot be closed`)); continue; }
          if (!input.correctionRationale) {
            plans.push(invalid(`${affected} student(s) are bound to or registered on ${c.type} ${c.code}: changing it needs a correction rationale (publish a new rule set for a new cohort)`));
            continue;
          }
          payload['_affectsStudents'] = affected;
        }
        if (c.type === 'module-offering' && typeof c.record['capacity'] === 'number') {
          const registered = await this.#offeringRegistrations(tx, tenantId, (current as { id?: string } | null)?.id ?? null);
          if (c.record['capacity'] < registered) { plans.push(invalid(`Capacity ${c.record['capacity']} is below the ${registered} students already registered`)); continue; }
        }
      }
      plans.push({ ...base, changeTypeCode: change, payload, issue: null });
    }
    // A reference to something this publication closes is invalid.
    const closing = new Set(plans.filter((p) => p.changeTypeCode === 'close').map((p) => `${p.objectTypeCode}:${p.objectCode}`));
    return plans.map((p) => {
      if (p.changeTypeCode === 'invalid' || p.changeTypeCode === 'close') return p;
      const deps = dependencies(p.objectTypeCode, (p.payload['_keys'] ?? {}) as Record<string, string | undefined>);
      const closed = deps.find((d) => closing.has(d));
      return closed ? { ...p, changeTypeCode: 'invalid' as const, issue: `It refers to ${closed.replace(':', ' ')}, which this publication closes` } : p;
    });
  }

  async #references(tx: TenantScopedDb, tenantId: string, c: Candidate, provided: Map<string, Candidate>): Promise<string | null> {
    for (const dep of dependencies(c.type, c.keys)) {
      if (provided.has(dep) && !provided.get(dep)!.closed) continue;
      const [type, code] = [dep.slice(0, dep.indexOf(':')) as ObjectType, dep.slice(dep.indexOf(':') + 1)];
      const keys = keysFor(type, code);
      if (!(await this.#current(tx, tenantId, type, keys))) return `It refers to ${type} ${code}, which is neither in this publication nor in the catalogue`;
    }
    if (c.type === 'module-offering') {
      const [period] = await tx.select({ id: academicPeriods.id }).from(academicPeriods).where(and(
        eq(academicPeriods.tenantId, tenantId as Uuid), eq(academicPeriods.academicYear, c.keys['academicYear']!), eq(academicPeriods.periodCode, c.keys['periodCode']!),
      )).limit(1);
      if (!period) return `Academic period ${c.keys['periodCode']} in ${c.keys['academicYear']} is not in the calendar`;
    }
    return null;
  }

  /** How many students depend on what this item changes or closes. */
  async #affected(tx: TenantScopedDb, tenantId: string, c: Candidate, current: unknown, change: ChangeType): Promise<number> {
    const t = tenantId as Uuid;
    const bindingsOn = async (column: 'programmeRuleSetId' | 'programmeRouteId', id: string | undefined) => {
      if (!id) return 0;
      const [row] = await tx.select({ n: sql<number>`count(*)::int` }).from(enrolmentCurriculumBindings).where(and(
        eq(enrolmentCurriculumBindings.tenantId, t), eq(enrolmentCurriculumBindings[column], id as Uuid), isNull(enrolmentCurriculumBindings.recordedUntil),
      ));
      return row?.n ?? 0;
    };
    switch (c.type) {
      case 'route': return bindingsOn('programmeRouteId', (current as { id?: string } | null)?.id);
      case 'rule-set': return bindingsOn('programmeRuleSetId', (current as { id?: string } | null)?.id);
      case 'module-group':
      case 'module-group-member': {
        // Adding to, changing or closing a group of a bound rule set changes the rules for its students.
        const ruleSet = await this.#current(tx, tenantId, 'rule-set', { programmeCode: c.keys['programmeCode'], ruleSetCode: c.keys['ruleSetCode'] });
        return bindingsOn('programmeRuleSetId', (ruleSet as { id?: string } | null)?.id);
      }
      case 'module': {
        if (!current || change === 'add') return 0;
        const [row] = await tx.select({ n: sql<number>`count(distinct ${moduleRegistrations.enrolmentId})::int` }).from(moduleRegistrations)
          .innerJoin(moduleOfferings, eq(moduleOfferings.id, moduleRegistrations.moduleOfferingId))
          .innerJoin(academicPeriods, eq(academicPeriods.id, moduleOfferings.academicPeriodId))
          .where(and(eq(moduleRegistrations.tenantId, t), eq(moduleOfferings.moduleId, (current as { id: string }).id as Uuid),
            ne(moduleRegistrations.statusCode, 'withdrawn'), gte(academicPeriods.endDate, clockNow().toISOString().slice(0, 10))));
        return row?.n ?? 0;
      }
      case 'module-offering': return this.#offeringRegistrations(tx, tenantId, (current as { id?: string } | null)?.id ?? null);
      default: return 0;
    }
  }

  async #offeringRegistrations(tx: TenantScopedDb, tenantId: string, offeringId: string | null): Promise<number> {
    if (!offeringId) return 0;
    const [row] = await tx.select({ n: sql<number>`count(*)::int` }).from(moduleRegistrations).where(and(
      eq(moduleRegistrations.tenantId, tenantId as Uuid), eq(moduleRegistrations.moduleOfferingId, offeringId as Uuid), ne(moduleRegistrations.statusCode, 'withdrawn'),
    ));
    return row?.n ?? 0;
  }

  // ── catalogue reads and writes per type ─────────────────────────────────────

  async #current(tx: TenantScopedDb, tenantId: string, type: ObjectType, keys: Record<string, string | undefined>): Promise<Record<string, unknown> | null> {
    const t = tenantId as Uuid;
    const live = <T extends { tenantId: unknown; recordedUntil: unknown; validTo: unknown }>(table: T) =>
      [eq((table as never as typeof programmes).tenantId, t), isNull((table as never as typeof programmes).recordedUntil), isNull((table as never as typeof programmes).validTo)];
    const one = async (q: Promise<unknown[]>) => ((await q)[0] as Record<string, unknown> | undefined) ?? null;
    switch (type) {
      case 'programme': return one(tx.select().from(programmes).where(and(...live(programmes), eq(programmes.code, keys['code']!))).limit(1));
      case 'module': return one(tx.select().from(modules).where(and(...live(modules), eq(modules.code, keys['code']!))).limit(1));
      case 'route': {
        const p = await this.#current(tx, tenantId, 'programme', { code: keys['programmeCode'] });
        if (!p) return null;
        return one(tx.select().from(programmeRoutes).where(and(...live(programmeRoutes), eq(programmeRoutes.programmeId, p['id'] as Uuid), eq(programmeRoutes.routeCode, keys['routeCode']!))).limit(1));
      }
      case 'rule-set': {
        const p = await this.#current(tx, tenantId, 'programme', { code: keys['programmeCode'] });
        if (!p) return null;
        return one(tx.select().from(programmeRuleSets).where(and(...live(programmeRuleSets), eq(programmeRuleSets.programmeId, p['id'] as Uuid), eq(programmeRuleSets.ruleSetCode, keys['ruleSetCode']!))).limit(1));
      }
      case 'module-group': {
        const rs = await this.#current(tx, tenantId, 'rule-set', keys);
        if (!rs) return null;
        return one(tx.select().from(moduleGroups).where(and(...live(moduleGroups), eq(moduleGroups.programmeRuleSetId, rs['id'] as Uuid), eq(moduleGroups.groupCode, keys['groupCode']!))).limit(1));
      }
      case 'module-group-member': {
        const g = await this.#current(tx, tenantId, 'module-group', keys);
        const m = await this.#current(tx, tenantId, 'module', { code: keys['moduleCode'] });
        if (!g || !m) return null;
        return one(tx.select().from(moduleGroupMembers).where(and(...live(moduleGroupMembers), eq(moduleGroupMembers.moduleGroupId, g['id'] as Uuid), eq(moduleGroupMembers.moduleId, m['id'] as Uuid))).limit(1));
      }
      case 'learning-outcome': {
        const owner = await this.#current(tx, tenantId, keys['ownerType'] === 'module' ? 'module' : 'programme', { code: keys['ownerCode'] });
        if (!owner) return null;
        const column = keys['ownerType'] === 'module' ? learningOutcomes.moduleId : learningOutcomes.programmeId;
        return one(tx.select().from(learningOutcomes).where(and(...live(learningOutcomes), eq(column, owner['id'] as Uuid), eq(learningOutcomes.outcomeCode, keys['outcomeCode']!))).limit(1));
      }
      case 'module-offering': {
        const m = await this.#current(tx, tenantId, 'module', { code: keys['moduleCode'] });
        if (!m) return null;
        return one(tx.select({ id: moduleOfferings.id, moduleId: moduleOfferings.moduleId, academicPeriodId: moduleOfferings.academicPeriodId, deliveryModeCode: moduleOfferings.deliveryModeCode, capacity: moduleOfferings.capacity })
          .from(moduleOfferings).innerJoin(academicPeriods, eq(academicPeriods.id, moduleOfferings.academicPeriodId))
          .where(and(eq(moduleOfferings.tenantId, t), eq(moduleOfferings.moduleId, m['id'] as Uuid), eq(academicPeriods.academicYear, keys['academicYear']!), eq(academicPeriods.periodCode, keys['periodCode']!))).limit(1));
      }
    }
  }

  async #write(
    tx: TenantScopedDb, tenantId: string, type: ObjectType, change: 'add' | 'change' | 'close', keys: Record<string, string | undefined>,
    fields: Record<string, unknown>, current: Record<string, unknown> | null, sourceReference: string | null, validFrom: Date, now: Date,
  ): Promise<string> {
    const t = tenantId as Uuid;
    if (type === 'module-offering') {
      if (change === 'add') {
        const m = (await this.#current(tx, tenantId, 'module', { code: keys['moduleCode'] }))!;
        const [period] = await tx.select({ id: academicPeriods.id }).from(academicPeriods).where(and(eq(academicPeriods.tenantId, t), eq(academicPeriods.academicYear, keys['academicYear']!), eq(academicPeriods.periodCode, keys['periodCode']!))).limit(1);
        const [row] = await tx.insert(moduleOfferings).values({ tenantId: t, moduleId: m['id'] as Uuid, academicPeriodId: period!.id, ...fields }).returning({ id: moduleOfferings.id });
        return row!.id;
      }
      const id = current!['id'] as Uuid;
      if (change === 'close') await tx.delete(moduleOfferings).where(eq(moduleOfferings.id, id));
      else await tx.update(moduleOfferings).set(fields).where(eq(moduleOfferings.id, id));
      return id;
    }

    const table = ({ programme: programmes, module: modules, route: programmeRoutes, 'rule-set': programmeRuleSets, 'module-group': moduleGroups, 'module-group-member': moduleGroupMembers, 'learning-outcome': learningOutcomes } as const)[type];
    if (change === 'add') {
      const entityId = randomUUID();
      const parents = await this.#parents(tx, tenantId, type, keys);
      await tx.insert(table).values({
        id: entityId, tenantId: t, ...parents, ...fields,
        ...(type === 'programme' || type === 'module' ? { code: keys['code'], sourceSystemReference: sourceReference } : {}),
        validFrom, validTo: null, recordedAt: now, recordedUntil: null,
      } as never);
      return entityId;
    }
    // change or close: close-and-replace the current version.
    const row = current as Record<string, unknown> & { versionId: string; validFrom: Date };
    await tx.update(table).set({ recordedUntil: now, validTo: validFrom }).where(eq((table as typeof programmes).versionId, row.versionId as Uuid));
    const { versionId: _v, recordedAt: _a, recordedUntil: _u, validFrom: _f, validTo: _t, ...carried } = row;
    await tx.insert(table).values({
      ...carried,
      ...(change === 'change' ? fields : {}),
      ...(sourceReference && (type === 'programme' || type === 'module') ? { sourceSystemReference: sourceReference } : {}),
      versionId: randomUUID(),
      // A closure keeps the record up to the effective date and ends it there.
      validFrom: change === 'close' ? row.validFrom : validFrom,
      validTo: change === 'close' ? validFrom : null,
      recordedAt: now, recordedUntil: null,
    } as never);
    return row['id'] as string;
  }

  /** The parent ids a new item needs, resolved now (earlier items in the same apply are already written). */
  async #parents(tx: TenantScopedDb, tenantId: string, type: ObjectType, keys: Record<string, string | undefined>): Promise<Record<string, unknown>> {
    const id = async (t: ObjectType, k: Record<string, string | undefined>) => (await this.#current(tx, tenantId, t, k))?.['id'] as string | undefined;
    switch (type) {
      case 'route': return { programmeId: await id('programme', { code: keys['programmeCode'] }), routeCode: keys['routeCode'] };
      case 'rule-set': return {
        programmeId: await id('programme', { code: keys['programmeCode'] }), ruleSetCode: keys['ruleSetCode'],
        programmeRouteId: keys['routeCode'] ? await id('route', { programmeCode: keys['programmeCode'], routeCode: keys['routeCode'] }) ?? null : null,
      };
      case 'module-group': return { programmeRuleSetId: await id('rule-set', keys), groupCode: keys['groupCode'] };
      case 'module-group-member': return { moduleGroupId: await id('module-group', keys), moduleId: await id('module', { code: keys['moduleCode'] }) };
      case 'learning-outcome': return keys['ownerType'] === 'module'
        ? { moduleId: await id('module', { code: keys['ownerCode'] }), programmeId: null, outcomeCode: keys['outcomeCode'] }
        : { programmeId: await id('programme', { code: keys['ownerCode'] }), moduleId: null, outcomeCode: keys['outcomeCode'] };
      default: return {};
    }
  }

  async #row(tenantId: string, id: string): Promise<CurriculumPublication | null> {
    const rows = await withTenantContext(this.db, tenantId, (tx) => tx.select().from(curriculumPublications)
      .where(and(eq(curriculumPublications.id, id as Uuid), eq(curriculumPublications.tenantId, tenantId as Uuid))).limit(1));
    return rows[0] ?? null;
  }

  async #bySourceRef(tenantId: string, source: string, ref: string): Promise<CurriculumPublication | null> {
    const rows = await withTenantContext(this.db, tenantId, (tx) => tx.select().from(curriculumPublications).where(and(
      eq(curriculumPublications.tenantId, tenantId as Uuid), eq(curriculumPublications.sourceSystemCode, source), eq(curriculumPublications.sourcePublicationRef, ref),
    )).limit(1));
    return rows[0] ?? null;
  }
}

// ── normalisation ──────────────────────────────────────────────────────────

/** One candidate per object, rule sets expanded into their groups and members. */
function flatten(input: ReceivePublicationInput): Candidate[] {
  const out: Candidate[] = [];
  const c = (type: ObjectType, keys: Record<string, string | undefined>, record: object, closed?: boolean, sourceReference?: string) =>
    out.push({ type, code: codeFor(type, keys), keys, record: record as Record<string, unknown>, closed: Boolean(closed), sourceReference: sourceReference ?? null });
  for (const p of input.programmes ?? []) c('programme', { code: p.code?.trim() }, p, p.closed, p.sourceReference);
  for (const m of input.modules ?? []) c('module', { code: m.code?.trim() }, m, m.closed, m.sourceReference);
  for (const r of input.routes ?? []) c('route', { programmeCode: r.programmeCode, routeCode: r.routeCode }, r, r.closed, r.sourceReference);
  for (const s of input.ruleSets ?? []) {
    const rsKeys = { programmeCode: s.programmeCode, ruleSetCode: s.ruleSetCode, ...(s.routeCode ? { routeCode: s.routeCode } : {}) };
    const { groups: _g, ...rs } = s;
    c('rule-set', rsKeys, rs, s.closed, s.sourceReference);
    for (const g of s.groups ?? []) {
      const { members: _m, ...group } = g;
      const gKeys = { programmeCode: s.programmeCode, ruleSetCode: s.ruleSetCode, groupCode: g.groupCode };
      c('module-group', gKeys, group, g.closed || s.closed, s.sourceReference);
      for (const m of g.members ?? []) c('module-group-member', { ...gKeys, moduleCode: m.moduleCode }, m, m.closed || g.closed || s.closed, s.sourceReference);
    }
  }
  for (const o of input.learningOutcomes ?? []) c('learning-outcome', { ownerType: o.ownerType, ownerCode: o.ownerCode, outcomeCode: o.outcomeCode }, o, o.closed, o.sourceReference);
  for (const f of input.offerings ?? []) c('module-offering', { moduleCode: f.moduleCode, academicYear: f.academicYear, periodCode: f.periodCode }, f, f.closed, f.sourceReference);
  return out;
}

function codeFor(type: ObjectType, k: Record<string, string | undefined>): string {
  switch (type) {
    case 'programme': case 'module': return k['code'] ?? '';
    case 'route': return `${k['programmeCode']}/${k['routeCode']}`;
    case 'rule-set': return `${k['programmeCode']}/${k['ruleSetCode']}`;
    case 'module-group': return `${k['programmeCode']}/${k['ruleSetCode']}/${k['groupCode']}`;
    case 'module-group-member': return `${k['programmeCode']}/${k['ruleSetCode']}/${k['groupCode']}/${k['moduleCode']}`;
    case 'learning-outcome': return `${k['ownerType']}:${k['ownerCode']}/${k['outcomeCode']}`;
    case 'module-offering': return `${k['moduleCode']}@${k['academicYear']}/${k['periodCode']}`;
  }
}

function keysFor(type: ObjectType, code: string): Record<string, string | undefined> {
  const parts = code.split('/');
  switch (type) {
    case 'programme': case 'module': return { code };
    case 'route': return { programmeCode: parts[0], routeCode: parts[1] };
    case 'rule-set': return { programmeCode: parts[0], ruleSetCode: parts[1] };
    case 'module-group': return { programmeCode: parts[0], ruleSetCode: parts[1], groupCode: parts[2] };
    default: return {};
  }
}

/** What an item depends on, as `type:code`. */
function dependencies(type: ObjectType, k: Record<string, string | undefined>): string[] {
  switch (type) {
    case 'route': return [`programme:${k['programmeCode']}`];
    case 'rule-set': return [`programme:${k['programmeCode']}`, ...(k['routeCode'] ? [`route:${k['programmeCode']}/${k['routeCode']}`] : [])];
    case 'module-group': return [`rule-set:${k['programmeCode']}/${k['ruleSetCode']}`];
    case 'module-group-member': return [`module-group:${k['programmeCode']}/${k['ruleSetCode']}/${k['groupCode']}`, `module:${k['moduleCode']}`];
    case 'learning-outcome': return [`${k['ownerType'] === 'module' ? 'module' : 'programme'}:${k['ownerCode']}`];
    case 'module-offering': return [`module:${k['moduleCode']}`];
    default: return [];
  }
}

function validateFields(c: Candidate): string | null {
  const r = c.record;
  const level = r['fheqLevel'];
  if (level !== undefined && (typeof level !== 'number' || level < 3 || level > 8)) return 'FHEQ level must be between 3 and 8';
  const credit = r['creditValue'] ?? r['creditTotal'];
  if (credit !== undefined && (!Number.isInteger(credit) || (credit as number) <= 0)) return 'Credit must be a positive whole number';
  if (c.type === 'module-group' && r['groupTypeCode'] !== undefined && !['compulsory', 'optional-pool', 'elective-pool'].includes(r['groupTypeCode'] as string)) {
    return 'A group is compulsory, an optional pool or an elective pool';
  }
  if (c.type === 'learning-outcome' && !['programme', 'module'].includes(c.keys['ownerType'] ?? '')) return 'A learning outcome belongs to a programme or a module';
  if (c.type === 'rule-set' && r['entryAcademicYear'] !== undefined && (typeof r['entryAcademicYear'] !== 'string' || !/^\d{4}-\d{2}$/.test(r['entryAcademicYear']))) return 'The entry year looks like 2027-28';
  if (c.type === 'module-offering' && r['capacity'] !== undefined && (!Number.isInteger(r['capacity']) || (r['capacity'] as number) < 0)) return 'Capacity must be a whole number';
  return null;
}

function requiredForAdd(c: Candidate): string | null {
  if (['programme', 'module', 'route', 'module-group'].includes(c.type) && !c.record['title']) return 'A new item needs a title';
  if (c.type === 'module-group' && !c.record['groupTypeCode']) return 'A new group needs its type';
  if (c.type === 'learning-outcome' && !c.record['description']) return 'A new learning outcome needs a description';
  return null;
}

function pick(source: Record<string, unknown>, fields: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(fields.filter((f) => source[f] !== undefined).map((f) => [f, source[f]]));
}

function publicationDto(row: CurriculumPublication, items: CurriculumPublicationItem[]): PublicationDto {
  const affected = (i: CurriculumPublicationItem) => Number((i.payload)['_affectsStudents'] ?? 0);
  return {
    publicationId: row.id, sourceSystemCode: row.sourceSystemCode, sourcePublicationRef: row.sourcePublicationRef,
    publicationVersion: row.publicationVersion, approvalRef: row.approvalRef, effectiveFrom: row.effectiveFrom, statusCode: row.statusCode,
    counts: { added: row.addedCount, changed: row.changedCount, closed: row.closedCount, unchanged: row.unchangedCount, rejected: row.rejectedCount },
    affectsStudents: items.reduce((n, i) => n + affected(i), 0),
    receivedBy: row.receivedBy, receivedAt: row.receivedAt, appliedBy: row.appliedBy, appliedAt: row.appliedAt,
    items: items.map((i) => ({
      itemId: i.id, objectTypeCode: i.objectTypeCode, objectCode: i.objectCode, sourceReference: i.sourceReference,
      changeTypeCode: i.changeTypeCode, issue: i.issue, appliedEntityId: i.appliedEntityId, affectsStudents: affected(i),
    })),
  };
}

