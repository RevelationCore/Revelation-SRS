import { createApiClient, ApiError } from '@revelation-srs/ui';

import { getStoredToken, clearToken } from './client.js';

export { ApiError };

// A second, separate API client pointed at the wellbeing module rather
// than core SRS — the wellbeing module is a genuinely separate deployable
// service (own database, own auth check, own permission model) that the
// admin app talks to directly for adjustment-case workflow, while core
// SRS is only ever shown the minimum-necessary distributed outcome once a
// case is approved (see AdjustmentsPage-adjacent reads in students.ts).
const wellbeingBaseUrl = import.meta.env.VITE_WELLBEING_API_URL ?? 'http://localhost:3002';

export const wellbeingApi = createApiClient({
  baseUrl:        wellbeingBaseUrl,
  getToken:       getStoredToken,
  onUnauthorized: () => {
    clearToken();
    window.location.href = '/login';
  },
});

// ── Evidence upload/download ────────────────────────────────────────────────
//
// The shared createApiClient always JSON-encodes its body, which can't
// carry a multipart file upload — these two helpers talk to the wellbeing
// module's evidence endpoints directly instead.

export async function uploadEvidence(
  caseId: string,
  file: File,
  evidenceTypeCode: string,
): Promise<{ id: string; documentId: string; checksumSha256: string }> {
  const form = new FormData();
  form.append('evidenceTypeCode', evidenceTypeCode);
  form.append('file', file);

  const token = getStoredToken();
  const res = await fetch(`${wellbeingBaseUrl}/api/v1/adjustment-cases/${caseId}/evidence`, {
    method:  'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body:    form,
  });

  if (res.status === 401) {
    clearToken();
    window.location.href = '/login';
    throw new ApiError(401, 'Unauthorized');
  }
  if (!res.ok) {
    let message = `Upload failed (${res.status})`;
    try {
      const body = await res.json() as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // response wasn't JSON — keep the generic message
    }
    throw new ApiError(res.status, message);
  }
  return res.json() as Promise<{ id: string; documentId: string; checksumSha256: string }>;
}

export function evidenceDownloadUrl(caseId: string, evidenceId: string): string {
  return `${wellbeingBaseUrl}/api/v1/adjustment-cases/${caseId}/evidence/${evidenceId}`;
}

export async function downloadEvidence(caseId: string, evidenceId: string): Promise<Blob> {
  const token = getStoredToken();
  const res = await fetch(evidenceDownloadUrl(caseId, evidenceId), {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new ApiError(res.status, `Download failed (${res.status})`);
  return res.blob();
}
