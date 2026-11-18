import { api, ApiError } from './client.js';

/** An applicant's own application, as the API shows it to them (Phase 5 D-39). */
export interface ApplicantApplication {
  applicationId: string;
  channelCode: string;
  cycle: string;
  programme: { programmeId: string | null; code: string | null; title: string | null };
  intakeCode: string | null;
  modeOfStudyCode: string | null;
  status: string;
  respondElsewhere: boolean;
  offer: null | {
    offerId: string; version: number; offerTypeCode: string; statusCode: string;
    expiresOn: string | null; responseCode: string | null; respondedAt: string | null;
    conditions: Array<{
      conditionId: string; description: string; requiredValue: string | null; statusCode: string;
      evidence: Array<{ evidenceId: string; receivedAt: string; verified: boolean }>;
    }>;
  };
  confirmation: null | { outcomeCode: string; decidedAt: string };
  cas: null | { statusCode: string; casNumber: string | null };
  withdrawnAt: string | null;
}

export const listApplications = (personId: string) =>
  api.get<ApplicantApplication[]>(`/api/v1/applicants/${personId}/applications`);
export const getApplication = (personId: string, applicationId: string) =>
  api.get<ApplicantApplication>(`/api/v1/applicants/${personId}/applications/${applicationId}`);
export const respondToOffer = (personId: string, offerId: string, responseCode: 'accept' | 'decline') =>
  api.post<ApplicantApplication>(`/api/v1/applicants/${personId}/offers/${offerId}/response`, { responseCode });
export const withdrawApplication = (personId: string, applicationId: string, reasonCode?: string) =>
  api.post<ApplicantApplication>(`/api/v1/applicants/${personId}/applications/${applicationId}/withdrawal`, reasonCode ? { reasonCode } : {});

/** Uploads evidence for a pending condition; staff verify it before deciding the condition. */
export async function uploadConditionEvidence(personId: string, conditionId: string, file: File): Promise<{ evidenceId: string }> {
  const form = new FormData();
  form.append('file', file);
  const token = localStorage.getItem('srs_portal_token');
  const res = await fetch(`${import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000'}/api/v1/applicants/${personId}/conditions/${conditionId}/evidence`, {
    method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {}, body: form,
  });
  if (!res.ok) {
    let message = `Upload failed (${res.status})`;
    try { const body = await res.json() as { detail?: string }; if (body.detail) message = body.detail; } catch { /* not JSON */ }
    throw new ApiError(res.status, message, message);
  }
  return res.json() as Promise<{ evidenceId: string }>;
}
