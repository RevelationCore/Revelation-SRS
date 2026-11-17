import { api } from './client.js';

/** Curriculum publications from the curriculum system (BP-03-001; D-7). */

export interface PublicationItem {
  itemId: string; objectTypeCode: string; objectCode: string; sourceReference: string | null;
  changeTypeCode: 'add' | 'change' | 'close' | 'unchanged' | 'invalid'; issue: string | null; appliedEntityId: string | null;
}
export interface Publication {
  publicationId: string; sourceSystemCode: string; sourcePublicationRef: string; publicationVersion: string; approvalRef: string | null;
  effectiveFrom: string; statusCode: 'validated' | 'rejected' | 'applied';
  counts: { added: number; changed: number; closed: number; unchanged: number; rejected: number };
  /** Students bound to or registered on what this publication changes (D-22). */
  affectsStudents?: number;
  receivedBy: string; receivedAt: string; appliedBy: string | null; appliedAt: string | null; items: PublicationItem[];
}

export const listPublications = () => api.get<Publication[]>('/api/v1/curriculum-publications');
export const getPublication = (id: string) => api.get<Publication>(`/api/v1/curriculum-publications/${id}`);
export const applyPublication = (id: string) => api.post<Publication>(`/api/v1/curriculum-publications/${id}/application`, {});
