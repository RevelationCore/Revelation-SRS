import type { ActivityDto, OfferingTimetable, SlotDto } from './timetable-service.js';

/** The `timetable-clash-policy` rule value (Phase 4 D-25), with its defaults. */
export interface ClashPolicy {
  policy: 'advisory' | 'blocking';
  toleranceMinutes: number;
  excludeActivityTypes: string[];
}

export const DEFAULT_CLASH_POLICY: ClashPolicy = { policy: 'advisory', toleranceMinutes: 0, excludeActivityTypes: ['online-asynchronous', 'drop-in'] };

export function clashPolicyFrom(value: Record<string, unknown> | null | undefined): ClashPolicy {
  const v = value ?? {};
  return {
    policy: v['policy'] === 'blocking' ? 'blocking' : 'advisory',
    toleranceMinutes: typeof v['toleranceMinutes'] === 'number' && v['toleranceMinutes'] >= 0 ? v['toleranceMinutes'] : 0,
    excludeActivityTypes: Array.isArray(v['excludeActivityTypes']) ? (v['excludeActivityTypes'] as string[]) : DEFAULT_CLASH_POLICY.excludeActivityTypes,
  };
}

export interface Clash {
  offeringA: string;
  offeringB: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  weeks: string[];
  publicationIds: string[];
}

const DAYS = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/**
 * A unit is one activity, or one group set (alternatives: the student
 * attends one). Two units clash only when every option of one clashes with
 * every option of the other, so no choice of group avoids it. Pairwise: a
 * clash reported is certain; one arising only across three or more group
 * choices can be missed, since group allocation is the timetabling system's.
 */
function units(t: OfferingTimetable, policy: ClashPolicy): ActivityDto[][] {
  const counted = t.activities.filter((a) => !policy.excludeActivityTypes.includes(a.activityTypeCode));
  const sets = new Map<string, ActivityDto[]>();
  const out: ActivityDto[][] = [];
  for (const a of counted) {
    if (!a.groupSetCode) { out.push([a]); continue; }
    const l = sets.get(a.groupSetCode) ?? [];
    l.push(a);
    sets.set(a.groupSetCode, l);
  }
  return [...out, ...sets.values()];
}

const minutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

function slotClash(a: SlotDto, b: SlotDto, tolerance: number): { weeks: string[] } | null {
  if (a.dayOfWeek !== b.dayOfWeek) return null;
  const overlap = Math.min(minutes(a.endTime), minutes(b.endTime)) - Math.max(minutes(a.startTime), minutes(b.startTime));
  if (overlap <= tolerance) return null;
  const weeks = a.weekCommencing.filter((w) => b.weekCommencing.includes(w));
  return weeks.length > 0 ? { weeks } : null;
}

/** The overlapping part of the first clashing pair of slots. */
function optionClash(a: ActivityDto, b: ActivityDto, tolerance: number): { slot: SlotDto; weeks: string[] } | null {
  for (const sa of a.slots) for (const sb of b.slots) {
    const c = slotClash(sa, sb, tolerance);
    if (c) {
      const startTime = sa.startTime > sb.startTime ? sa.startTime : sb.startTime;
      const endTime = sa.endTime < sb.endTime ? sa.endTime : sb.endTime;
      return { slot: { ...sa, startTime, endTime }, weeks: c.weeks };
    }
  }
  return null;
}

/** The first unavoidable clash between two offerings' timetables, or null. */
export function clashBetween(a: OfferingTimetable, b: OfferingTimetable, policy: ClashPolicy): Clash | null {
  for (const ua of units(a, policy)) for (const ub of units(b, policy)) {
    let first: { slot: SlotDto; weeks: string[] } | null = null;
    let all = true;
    for (const oa of ua) {
      for (const ob of ub) {
        const c = optionClash(oa, ob, policy.toleranceMinutes);
        if (!c) { all = false; break; }
        first ??= c;
      }
      if (!all) break;
    }
    if (all && first) {
      return {
        offeringA: a.moduleOfferingId, offeringB: b.moduleOfferingId, dayOfWeek: first.slot.dayOfWeek,
        startTime: first.slot.startTime, endTime: first.slot.endTime, weeks: first.weeks, publicationIds: [...new Set([a.publicationId, b.publicationId])],
      };
    }
  }
  return null;
}

export function describeClash(c: Clash, codeA: string, codeB: string): string {
  const weeks = c.weeks.length > 3 ? `${c.weeks.length} weeks from ${c.weeks[0]}` : `weeks of ${c.weeks.join(', ')}`;
  return `${codeA} clashes with ${codeB} on ${DAYS[c.dayOfWeek]} ${c.startTime}–${c.endTime} (${weeks}; timetable ${c.publicationIds.map((p) => p.slice(0, 8)).join(', ')})`;
}
