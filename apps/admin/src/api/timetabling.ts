import { api } from './client.js';

/** Timetable publications from the timetabling system (Phase 4 D-24). */
export interface TimetablePublication {
  timetablePublicationId: string;
  academicPeriodId: string;
  sourceSystemCode: 'ttb' | 'srs-admin' | 'simulator';
  sourceVersion: string;
  fullPeriod: boolean;
  statusCode: 'applied' | 'rejected';
  rejectionReasons: string[];
  rowCount: number;
  receivedBy: string;
  receivedAt: string;
  appliedAt: string | null;
}

export const listTimetablePublications = (academicPeriodId?: string) =>
  api.get<TimetablePublication[]>(`/api/v1/timetable-publications${academicPeriodId ? `?academicPeriodId=${academicPeriodId}` : ''}`);
export const uploadTimetablePublication = (body: Record<string, unknown>) =>
  api.post<TimetablePublication>('/api/v1/timetable-publications', body);
export const simulateTimetable = (academicPeriodId: string) =>
  api.post<TimetablePublication>(`/api/v1/academic-periods/${academicPeriodId}/timetable-simulation`, {});
export const getTimetableStatus = (academicPeriodId: string) =>
  api.get<{ lastAppliedAt: string | null; stale: boolean; staleAfterHours: number }>(`/api/v1/academic-periods/${academicPeriodId}/timetable-status`);
