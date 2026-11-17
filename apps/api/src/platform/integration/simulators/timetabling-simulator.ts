import { createHash } from 'node:crypto';

import type { ActivityInput, PublicationInput } from '../../timetabling/timetable-service.js';

/**
 * An in-repo timetabling simulator (Phase 4 D-24, D-14), used by tests, demo
 * data and the golden suite. It derives a plausible timetable from an
 * academic period's offerings: each offering gets a lecture and a choice of
 * two seminar groups, on days and hours derived from the offering id, every
 * week of the period. The same offerings always produce the same timetable.
 * Its publications are marked source 'simulator', never 'ttb'.
 */
export function simulateTimetable(
  period: { academicPeriodId: string; startDate: string; endDate: string },
  offerings: Array<{ moduleOfferingId: string; moduleCode: string }>,
  version: string,
): PublicationInput {
  const weeks = mondaysBetween(period.startDate, period.endDate).slice(0, 12);
  const activities: ActivityInput[] = [];
  for (const o of offerings) {
    const h = createHash('sha256').update(o.moduleOfferingId).digest();
    const day = 1 + (h[0]! % 5);
    const hour = 9 + (h[1]! % 8);
    const seminarDay = 1 + ((day + (h[2]! % 4)) % 5);
    const slot = (d: number, start: number) => ({ dayOfWeek: d, startTime: hh(start), endTime: hh(start + 1), weekCommencing: weeks, locationRef: `SIM-${(h[3]! % 40) + 1}` });
    activities.push({ moduleOfferingId: o.moduleOfferingId, activityRef: `${o.moduleCode}-LEC`, activityTypeCode: 'lecture', slots: [slot(day, hour)] });
    for (const [n, g] of ['A', 'B'].entries()) {
      activities.push({
        moduleOfferingId: o.moduleOfferingId, activityRef: `${o.moduleCode}-SEM-${g}`, activityTypeCode: 'seminar',
        groupSetCode: 'SEM', groupCode: g, slots: [slot(seminarDay, 9 + ((hour - 9 + 2 + n * 3) % 8))],
      });
    }
  }
  return { academicPeriodId: period.academicPeriodId, sourceVersion: version, fullPeriod: true, activities };
}

function hh(hour: number): string {
  return `${String(hour).padStart(2, '0')}:00`;
}

export function mondaysBetween(startDate: string, endDate: string): string[] {
  const d = new Date(`${startDate}T00:00:00Z`);
  while (d.getUTCDay() !== 1) d.setUTCDate(d.getUTCDate() + 1);
  const end = new Date(`${endDate}T00:00:00Z`);
  const out: string[] = [];
  while (d <= end) { out.push(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() + 7); }
  return out;
}
