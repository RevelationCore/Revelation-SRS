import { createApiClient, ApiError } from '@revelation-srs/ui';

export { ApiError };

const ACCESS_KEY = 'srs_portal_token';

// A second API client pointed at the wellbeing module rather than core
// SRS — a separate deployable service (own database, own auth check) that
// this app talks to directly for a student's own adjustment-case
// requests. Core SRS is only ever shown the minimum-necessary distributed
// outcome once a case is approved (see AdjustmentsPage's existing
// read-only "distributed outcomes" section).
const wellbeingBaseUrl = import.meta.env.VITE_WELLBEING_API_URL ?? 'http://localhost:3002';

function getStoredToken(): string | null {
  return localStorage.getItem(ACCESS_KEY);
}

export const wellbeingApi = createApiClient({
  baseUrl:        wellbeingBaseUrl,
  getToken:       getStoredToken,
  onUnauthorized: () => {
    localStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem('srs_portal_refresh_token');
    window.location.href = '/login';
  },
});

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
    localStorage.removeItem(ACCESS_KEY);
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

export async function downloadEvidence(caseId: string, evidenceId: string): Promise<Blob> {
  const token = getStoredToken();
  const res = await fetch(`${wellbeingBaseUrl}/api/v1/adjustment-cases/${caseId}/evidence/${evidenceId}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new ApiError(res.status, `Download failed (${res.status})`);
  return res.blob();
}
