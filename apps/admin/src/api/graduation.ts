import { api } from './client.js';

/** Graduation cycles, invitations and ceremonies (BP-06-005; D-4). */

export interface GraduationCycleSummary {
  cycleId: string; cycleCode: string; title: string; awardsFrom: string; awardsTo: string; statusCode: string; createdAt: string; frozenAt: string | null;
}
export interface Ceremony { ceremonyId: string; ceremonyCode: string; startsAt: string; venue: string; capacity: number; guestLimit: number; allocated: number }
export interface GraduationCycle extends GraduationCycleSummary { ceremonies: Ceremony[] }
export interface CycleInvitation {
  invitationId: string; cycleId: string; awardId: string; personId: string; responseCode: string; guestCount: number;
  accessibilityRequired: boolean; respondedAt: string | null; createdAt: string; studentName: string; studentNumber: string;
  allocation: { allocationId: string; ceremonyId: string; presentationOrder: number | null; attendanceCode: string } | null;
}
export interface NewCycle {
  cycleCode: string; title: string; awardsFrom: string; awardsTo: string;
  ceremonies: Array<{ ceremonyCode: string; startsAt: string; venue: string; capacity: number; guestLimit?: number }>;
}

export const listGraduationCycles = () => api.get<GraduationCycleSummary[]>('/api/v1/graduation-cycles');
export const getGraduationCycle = (id: string) => api.get<GraduationCycle>(`/api/v1/graduation-cycles/${id}`);
export const createGraduationCycle = (body: NewCycle) => api.post<GraduationCycle>('/api/v1/graduation-cycles', body);
export const deriveInvitations = (id: string) =>
  api.post<{ invited: number; alreadyInvited: number; previouslyPresented: number }>(`/api/v1/graduation-cycles/${id}/invitations`, {});
export const listCycleInvitations = (id: string) => api.get<CycleInvitation[]>(`/api/v1/graduation-cycles/${id}/invitations`);
export const allocateInvitation = (invitationId: string, ceremonyId: string) =>
  api.post(`/api/v1/graduation-invitations/${invitationId}/allocation`, { ceremonyId });
export const freezeCycle = (id: string) => api.post(`/api/v1/graduation-cycles/${id}/freeze`, {});
export const recordAttendance = (allocationId: string, attendanceCode: 'attended' | 'absent') =>
  api.post(`/api/v1/ceremony-allocations/${allocationId}/attendance`, { attendanceCode });
