import { createHash } from 'node:crypto';

import { deterministicId } from './ids.js';

/**
 * A deterministic timetable for a period's offerings (Phase 4 D-24), in the
 * shape the in-repo timetabling simulator produces: per offering a lecture
 * and a choice of two seminar groups, every week for the first twelve
 * weeks. Marked as a simulator publication, never as the institution's
 * timetabling system.
 */
export function generateTimetable(
  tenantId: string,
  period: { id: string; startDate: string; endDate: string; academicYear: string; periodCode: string },
  offerings: Array<{ id: string; moduleCode: string }>,
) {
  const publicationId = deterministicId('timetable-publication', tenantId, period.id);
  const weeks = mondays(period.startDate, period.endDate).slice(0, 12);
  const activities: Array<Record<string, unknown>> = [];
  const slots: Array<Record<string, unknown>> = [];
  for (const o of offerings) {
    const h = createHash('sha256').update(o.id).digest();
    const day = 1 + (h[0]! % 5);
    const hour = 9 + (h[1]! % 8);
    const seminarDay = 1 + ((day + (h[2]! % 4)) % 5);
    const add = (ref: string, type: string, d: number, start: number, group: string | null) => {
      const activityId = deterministicId('timetable-activity', tenantId, period.id, o.id, ref);
      activities.push({ id: activityId, tenantId, publicationId, moduleOfferingId: o.id, activityRef: ref, activityTypeCode: type, groupSetCode: group ? 'SEM' : null, groupCode: group });
      slots.push({
        id: deterministicId('timetable-slot', tenantId, activityId), tenantId, activityId, dayOfWeek: d,
        startTime: `${String(start).padStart(2, '0')}:00`, endTime: `${String(start + 1).padStart(2, '0')}:00`, weekCommencing: weeks, locationRef: `SIM-${(h[3]! % 40) + 1}`,
      });
    };
    add(`${o.moduleCode}-LEC`, 'lecture', day, hour, null);
    add(`${o.moduleCode}-SEM-A`, 'seminar', seminarDay, 9 + ((hour - 9 + 2) % 8), 'A');
    add(`${o.moduleCode}-SEM-B`, 'seminar', seminarDay, 9 + ((hour - 9 + 5) % 8), 'B');
  }
  const publication = {
    id: publicationId, tenantId, academicPeriodId: period.id, sourceSystemCode: 'simulator', sourceVersion: `demo-${period.academicYear}-${period.periodCode}`,
    fullPeriod: true, statusCode: 'applied', rejectionReasons: null, payloadHash: createHash('sha256').update(publicationId).digest('hex'),
    rowCount: activities.length, receivedBy: 'demo-loader', receivedAt: new Date(`${period.startDate}T00:00:00Z`), appliedAt: new Date(`${period.startDate}T00:00:00Z`),
  };
  return { publication, activities, slots };
}

function mondays(startDate: string, endDate: string): string[] {
  const d = new Date(`${startDate}T00:00:00Z`);
  while (d.getUTCDay() !== 1) d.setUTCDate(d.getUTCDate() + 1);
  const end = new Date(`${endDate}T00:00:00Z`);
  const out: string[] = [];
  while (d <= end) { out.push(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() + 7); }
  return out;
}
