import { createHash } from 'node:crypto';

import {
  academicPeriods,
  moduleOfferings,
  modules,
  tenants,
  timetableActivities,
  timetablePublications,
  timetableSlots,
  type Db,
  type TimetablePublication,
  withTenantContext,
} from '@revelation-srs/db';
import { ConflictError, NotFoundError, ValidationError } from '@revelation-srs/domain';
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';

import { clockNow } from '../clock.js';
import type { ValueSetService } from '../value-sets/service.js';

type Uuid = `${string}-${string}-${string}-${string}-${string}`;

export type TimetableSource = 'ttb' | 'srs-admin' | 'simulator';

export interface SlotInput { dayOfWeek: number; startTime: string; endTime: string; weekCommencing: string[]; locationRef?: string | null }
export interface ActivityInput {
  moduleOfferingId?: string;
  moduleCode?: string;
  academicYear?: string;
  periodCode?: string;
  activityRef: string;
  activityTypeCode: string;
  groupSetCode?: string | null;
  groupCode?: string | null;
  slots: SlotInput[];
}
/** Contract timetable-publication.v1 (schemas/file-contracts/timetabling). */
export interface PublicationInput {
  academicPeriodId: string;
  sourceVersion: string;
  fullPeriod?: boolean;
  activities: ActivityInput[];
}

export interface PublicationDto {
  timetablePublicationId: string;
  academicPeriodId: string;
  sourceSystemCode: string;
  sourceVersion: string;
  fullPeriod: boolean;
  statusCode: 'applied' | 'rejected';
  rejectionReasons: string[];
  rowCount: number;
  receivedBy: string;
  receivedAt: Date;
  appliedAt: Date | null;
}

export interface SlotDto { dayOfWeek: number; startTime: string; endTime: string; weekCommencing: string[]; locationRef: string | null }
export interface ActivityDto { activityRef: string; activityTypeCode: string; groupSetCode: string | null; groupCode: string | null; slots: SlotDto[] }
export interface OfferingTimetable { moduleOfferingId: string; publicationId: string; activities: ActivityDto[] }

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Timetables from the timetabling system (Phase 4 D-24; F-TTB-SIS-01).
 * Each publication is kept as received: applied when every offering it
 * names resolves, otherwise rejected as a whole with its reasons, so the
 * previous timetable stays current (BP-03-006 E4: never guess). An
 * offering's current timetable is its activities in the latest applied
 * publication containing it, unless a later full-period publication has
 * dropped it. The SRS does not master this data, so no second approver is
 * needed; validation messages cite the publication a clash was found in.
 */
export class TimetableService {
  constructor(private readonly db: Db, private readonly valueSets: ValueSetService) {}

  async receive(tenantId: string, source: TimetableSource, input: PublicationInput, actorId: string): Promise<PublicationDto> {
    const t = tenantId as Uuid;
    if (!input.sourceVersion?.trim()) throw new ValidationError('sourceVersion is required');
    const payloadHash = createHash('sha256').update(JSON.stringify(input)).digest('hex');
    const [existing] = await withTenantContext(this.db, tenantId, (tx) => tx.select().from(timetablePublications).where(and(
      eq(timetablePublications.tenantId, t), eq(timetablePublications.sourceSystemCode, source), eq(timetablePublications.sourceVersion, input.sourceVersion),
    )).limit(1));
    if (existing) {
      if (existing.payloadHash === payloadHash) return publicationDto(existing);
      throw new ConflictError(`Publication ${input.sourceVersion} from ${source} was already received with different content; send a new version`);
    }
    const [period] = await withTenantContext(this.db, tenantId, (tx) => tx.select().from(academicPeriods)
      .where(and(eq(academicPeriods.tenantId, t), eq(academicPeriods.id, input.academicPeriodId as Uuid))).limit(1));
    if (!period) throw new NotFoundError('AcademicPeriod', input.academicPeriodId);

    const reasons: string[] = [];
    const resolved: Array<{ offeringId: string; activity: ActivityInput }> = [];
    const offerings = await withTenantContext(this.db, tenantId, (tx) => tx.select({ id: moduleOfferings.id, code: modules.code, periodId: moduleOfferings.academicPeriodId })
      .from(moduleOfferings).innerJoin(modules, and(eq(modules.id, moduleOfferings.moduleId), isNull(modules.recordedUntil)))
      .where(and(eq(moduleOfferings.tenantId, t), eq(moduleOfferings.academicPeriodId, period.id))));
    const types = new Set<string>();
    const refs = new Set<string>();
    for (const [n, a] of (input.activities ?? []).entries()) {
      const where = `activity ${n + 1} (${a.activityRef ?? 'no ref'})`;
      if (!a.activityRef) reasons.push(`${where}: activityRef is required`);
      if (refs.has(a.activityRef)) reasons.push(`${where}: activityRef appears more than once`);
      refs.add(a.activityRef);
      let offeringId: string | undefined;
      if (a.moduleOfferingId) {
        offeringId = offerings.find((o) => o.id === a.moduleOfferingId)?.id;
        if (!offeringId) reasons.push(`${where}: offering ${a.moduleOfferingId} is not in this period`);
      } else if (a.moduleCode) {
        if ((a.academicYear && a.academicYear !== period.academicYear) || (a.periodCode && a.periodCode !== period.periodCode)) {
          reasons.push(`${where}: ${a.moduleCode} names a different period (${a.academicYear ?? '?'} ${a.periodCode ?? '?'})`);
        } else {
          const matches = offerings.filter((o) => o.code === a.moduleCode);
          if (matches.length === 1) offeringId = matches[0]!.id;
          else reasons.push(`${where}: module ${a.moduleCode} has ${matches.length === 0 ? 'no offering' : `${matches.length} offerings`} in this period`);
        }
      } else {
        reasons.push(`${where}: name the offering by moduleOfferingId or moduleCode`);
      }
      if (!types.has(a.activityTypeCode)) {
        if ((await this.valueSets.validateFieldValue('timetable_activity', 'activity_type_code', a.activityTypeCode, tenantId)) === false) {
          reasons.push(`${where}: unknown activity type '${a.activityTypeCode}'`);
        } else types.add(a.activityTypeCode);
      }
      if (!Array.isArray(a.slots) || a.slots.length === 0) reasons.push(`${where}: needs at least one slot`);
      for (const s of a.slots ?? []) {
        if (!Number.isInteger(s.dayOfWeek) || s.dayOfWeek < 1 || s.dayOfWeek > 7) reasons.push(`${where}: dayOfWeek must be 1 (Monday) to 7`);
        if (!TIME.test(s.startTime) || !TIME.test(s.endTime) || s.endTime <= s.startTime) reasons.push(`${where}: times must be HH:MM with the end after the start`);
        if (!Array.isArray(s.weekCommencing) || s.weekCommencing.length === 0) reasons.push(`${where}: weekCommencing needs at least one week`);
        for (const w of s.weekCommencing ?? []) {
          const d = new Date(`${w}T00:00:00Z`);
          if (Number.isNaN(d.getTime()) || d.getUTCDay() !== 1) reasons.push(`${where}: week ${w} is not a Monday`);
        }
      }
      if (offeringId) resolved.push({ offeringId, activity: a });
    }

    const now = clockNow();
    const status = reasons.length > 0 ? 'rejected' : 'applied';
    const row = await withTenantContext(this.db, tenantId, async (tx) => {
      const [pub] = await tx.insert(timetablePublications).values({
        tenantId: t, academicPeriodId: period.id, sourceSystemCode: source, sourceVersion: input.sourceVersion, fullPeriod: input.fullPeriod ?? false,
        statusCode: status, rejectionReasons: reasons.length > 0 ? [...new Set(reasons)] : null, payloadHash,
        rowCount: (input.activities ?? []).length, receivedBy: actorId, receivedAt: now, appliedAt: status === 'applied' ? now : null,
      }).returning();
      if (status === 'applied') {
        for (const { offeringId, activity } of resolved) {
          const [act] = await tx.insert(timetableActivities).values({
            tenantId: t, publicationId: pub!.id, moduleOfferingId: offeringId as Uuid, activityRef: activity.activityRef,
            activityTypeCode: activity.activityTypeCode, groupSetCode: activity.groupSetCode ?? null, groupCode: activity.groupCode ?? null,
          }).returning();
          for (const s of activity.slots) {
            await tx.insert(timetableSlots).values({
              tenantId: t, activityId: act!.id, dayOfWeek: s.dayOfWeek, startTime: s.startTime, endTime: s.endTime,
              weekCommencing: [...s.weekCommencing].sort(), locationRef: s.locationRef ?? null,
            });
          }
        }
      }
      return pub!;
    });
    return publicationDto(row);
  }

  async listPublications(tenantId: string, academicPeriodId?: string): Promise<PublicationDto[]> {
    const rows = await withTenantContext(this.db, tenantId, (tx) => tx.select().from(timetablePublications).where(and(
      eq(timetablePublications.tenantId, tenantId as Uuid),
      ...(academicPeriodId ? [eq(timetablePublications.academicPeriodId, academicPeriodId as Uuid)] : []),
    )).orderBy(desc(timetablePublications.receivedAt)).limit(200));
    return rows.map(publicationDto);
  }

  /** The current timetable of each offering, from the latest applied publication containing it. */
  async currentFor(tenantId: string, offeringIds: string[]): Promise<Map<string, OfferingTimetable>> {
    const result = new Map<string, OfferingTimetable>();
    if (offeringIds.length === 0) return result;
    const t = tenantId as Uuid;
    return withTenantContext(this.db, tenantId, async (tx) => {
      const periodRows = await tx.select({ id: moduleOfferings.id, periodId: moduleOfferings.academicPeriodId }).from(moduleOfferings)
        .where(and(eq(moduleOfferings.tenantId, t), inArray(moduleOfferings.id, offeringIds as Uuid[])));
      const periodIds = [...new Set(periodRows.map((p) => p.periodId))];
      const pubs = await tx.select().from(timetablePublications).where(and(
        eq(timetablePublications.tenantId, t), eq(timetablePublications.statusCode, 'applied'), inArray(timetablePublications.academicPeriodId, periodIds as Uuid[]),
      )).orderBy(desc(timetablePublications.appliedAt), desc(timetablePublications.receivedAt));
      if (pubs.length === 0) return result;
      const acts = await tx.select().from(timetableActivities).where(and(
        eq(timetableActivities.tenantId, t), inArray(timetableActivities.publicationId, pubs.map((p) => p.id)), inArray(timetableActivities.moduleOfferingId, offeringIds as Uuid[]),
      ));
      const slots = acts.length === 0 ? [] : await tx.select().from(timetableSlots).where(and(eq(timetableSlots.tenantId, t), inArray(timetableSlots.activityId, acts.map((a) => a.id))));
      for (const o of periodRows) {
        for (const pub of pubs.filter((p) => p.academicPeriodId === o.periodId)) {
          const mine = acts.filter((a) => a.publicationId === pub.id && a.moduleOfferingId === o.id);
          if (mine.length > 0) {
            result.set(o.id, {
              moduleOfferingId: o.id, publicationId: pub.id,
              activities: mine.map((a) => ({
                activityRef: a.activityRef, activityTypeCode: a.activityTypeCode, groupSetCode: a.groupSetCode, groupCode: a.groupCode,
                slots: slots.filter((s) => s.activityId === a.id).map((s) => ({
                  dayOfWeek: s.dayOfWeek, startTime: s.startTime.slice(0, 5), endTime: s.endTime.slice(0, 5), weekCommencing: s.weekCommencing, locationRef: s.locationRef,
                })),
              })),
            });
            break;
          }
          if (pub.fullPeriod) break; // a later full-period publication dropped this offering
        }
      }
      return result;
    });
  }

  /** When the period's timetable was last applied, and whether that is older than timetabling.staleAfterHours (default 168). */
  async freshness(tenantId: string, academicPeriodId: string): Promise<{ lastAppliedAt: Date | null; stale: boolean; staleAfterHours: number }> {
    const [cfg] = await this.db.select({ configuration: tenants.configuration }).from(tenants).where(eq(tenants.id, tenantId as Uuid)).limit(1);
    const tt = (cfg?.configuration?.['timetabling'] ?? {}) as Record<string, unknown>;
    const staleAfterHours = typeof tt['staleAfterHours'] === 'number' && tt['staleAfterHours'] > 0 ? tt['staleAfterHours'] : 168;
    const [last] = await withTenantContext(this.db, tenantId, (tx) => tx.select({ appliedAt: timetablePublications.appliedAt }).from(timetablePublications).where(and(
      eq(timetablePublications.tenantId, tenantId as Uuid), eq(timetablePublications.academicPeriodId, academicPeriodId as Uuid), eq(timetablePublications.statusCode, 'applied'),
    )).orderBy(desc(timetablePublications.appliedAt)).limit(1));
    const lastAppliedAt = last?.appliedAt ?? null;
    const stale = !lastAppliedAt || clockNow().getTime() - lastAppliedAt.getTime() > staleAfterHours * 3_600_000;
    return { lastAppliedAt, stale, staleAfterHours };
  }
}

function publicationDto(p: TimetablePublication): PublicationDto {
  return {
    timetablePublicationId: p.id, academicPeriodId: p.academicPeriodId, sourceSystemCode: p.sourceSystemCode, sourceVersion: p.sourceVersion,
    fullPeriod: p.fullPeriod, statusCode: p.statusCode as 'applied' | 'rejected', rejectionReasons: p.rejectionReasons ?? [], rowCount: p.rowCount,
    receivedBy: p.receivedBy, receivedAt: p.receivedAt, appliedAt: p.appliedAt,
  };
}
