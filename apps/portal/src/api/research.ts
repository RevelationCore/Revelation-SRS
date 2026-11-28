import { bffFetch } from '@revelation-srs/ui';

import { api, ApiError, SRS_BASE } from './client.js';

/** Supervisor, review panel and examiner self-service (Phase 5 D-40). */
export interface ResearchAssignments {
  supervisees: Array<{ enrolmentId: string; studentName: string | null; programme: string | null; role: string }>;
  panels: Array<{ reviewId: string; studentName: string | null; reviewTypeCode: string; statusCode: string; role: string }>;
  examinations: Array<{ examinationCaseId: string; studentName: string | null; statusCode: string; examinerRoleCode: string; reportSubmitted: boolean }>;
}

export interface SuperviseeView {
  enrolmentId: string; studentName: string | null; programme: string | null;
  team: Array<{ name: string | null; roleDetailCode: string; validFrom: string }>;
  milestones: Array<{ milestoneTypeCode: string; achievedDate: string }>;
  progressReviews: Array<{ reviewId: string; reviewTypeCode: string; statusCode: string; outcomeCode: string | null }>;
  examinations: Array<{ examinationCaseId: string; statusCode: string; examiners: Array<{ name: string | null; examinerRoleCode: string }>; ratifiedOutcomeCode: string | null; correctionDeadlines: Array<{ deadlineDate: string; completed: boolean }> }>;
}

export interface PanelReviewView {
  reviewId: string; reviewTypeCode: string; statusCode: string; studentName: string | null; memberId: string; role: string;
  evidence: Array<{ evidenceId: string; sourceSystem: string; receivedAt: string; downloadable: boolean }>;
}

export interface ExaminationView {
  examinationCaseId: string; statusCode: string; studentName: string | null;
  thesis: { versionNumber: number; formatCode: string; submittedAt: string; downloadable: boolean; storageRef: string | null } | null;
  appointment: { appointmentId: string; examinerRoleCode: string; confirmed: boolean; independenceChecked: boolean; conflictTypeCode: string | null };
  coExaminers: Array<{ name: string | null; examinerRoleCode: string }>;
  ownReport: { reportId: string; recommendationCode: string | null; submittedAt: string } | null;
  reportExchange: string;
  otherReports: Array<{ recommendationCode: string | null; submittedAt: string }> | null;
}

const base = (personId: string) => `/api/v1/research-staff/${personId}/pgr`;
export const getAssignments = (personId: string) => api.get<ResearchAssignments>(`${base(personId)}/assignments`);
export const getSupervisee = (personId: string, enrolmentId: string) => api.get<SuperviseeView>(`${base(personId)}/supervisees/${enrolmentId}`);
export const getPanelReview = (personId: string, reviewId: string) => api.get<PanelReviewView>(`${base(personId)}/progress-reviews/${reviewId}`);
export const getExamination = (personId: string, caseId: string) => api.get<ExaminationView>(`${base(personId)}/examinations/${caseId}`);
export const declareReviewConflict = (personId: string, memberId: string, conflictTypeCode: string) =>
  api.post(`${base(personId)}/review-members/${memberId}/conflict`, { conflictTypeCode });
export const declareExaminerConflict = (personId: string, caseId: string, appointmentId: string, conflictTypeCode: string) =>
  api.post(`${base(personId)}/examinations/${caseId}/appointments/${appointmentId}/conflict`, { conflictTypeCode });

const root = () => SRS_BASE;

async function postForm<T>(path: string, form: FormData): Promise<T> {
  const res = await bffFetch(`${root()}${path}`, { method: 'POST', headers: {}, body: form });
  if (!res.ok) {
    let message = `Upload failed (${res.status})`;
    try { const body = await res.json() as { detail?: string }; if (body.detail) message = body.detail; } catch { /* not JSON */ }
    throw new ApiError(res.status, message, message);
  }
  return res.json() as Promise<T>;
}

export function submitExaminerReport(personId: string, caseId: string, file: File, recommendationCode: string): Promise<{ reportId: string }> {
  const form = new FormData();
  if (recommendationCode) form.append('recommendationCode', recommendationCode);
  form.append('file', file);
  return postForm(`${base(personId)}/examinations/${caseId}/report`, form);
}

export function submitSupervisorReport(personId: string, reviewId: string, file: File): Promise<{ evidenceId: string }> {
  const form = new FormData();
  form.append('file', file);
  return postForm(`${base(personId)}/progress-reviews/${reviewId}/supervisor-report`, form);
}

/** Downloads a file the API logs access to, and hands it to the browser. */
export async function downloadFile(path: string, filename: string): Promise<void> {
  const res = await bffFetch(`${root()}${path}`, { headers: {} });
  if (!res.ok) throw new ApiError(res.status, `Download failed (${res.status})`);
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}
export const thesisPath = (personId: string, caseId: string) => `${base(personId)}/examinations/${caseId}/thesis`;
export const reviewEvidencePath = (personId: string, reviewId: string, evidenceId: string) => `${base(personId)}/progress-reviews/${reviewId}/evidence/${evidenceId}/content`;
