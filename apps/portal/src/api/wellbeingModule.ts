import { bffFetch, createApiClient, ApiError } from '@revelation-srs/ui';

import { signInAgain } from './client.js';

export { ApiError };

// A second API client pointed at the wellbeing module rather than core
// SRS — a separate deployable service (own database, own auth check) that
// this app talks to directly for a student's own adjustment-case
// requests. Core SRS is only ever shown the minimum-necessary distributed
// outcome once a case is approved (see AdjustmentsPage's existing
// read-only "distributed outcomes" section).
const wellbeingBaseUrl = '/bff/wellbeing';

// Through this app's BFF (ADR-026), which adds the access token.
export const wellbeingApi = createApiClient({ baseUrl: wellbeingBaseUrl, onUnauthorized: signInAgain });

export async function uploadEvidence(
  caseId: string,
  file: File,
  evidenceTypeCode: string,
): Promise<{ id: string; documentId: string; checksumSha256: string }> {
  const form = new FormData();
  form.append('evidenceTypeCode', evidenceTypeCode);
  form.append('file', file);
  const res = await bffFetch(`${wellbeingBaseUrl}/api/v1/adjustment-cases/${caseId}/evidence`, {
    method:  'POST',
    headers: {},
    body:    form,
  });

  if (res.status === 401) {
    signInAgain();
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
  const res = await bffFetch(`${wellbeingBaseUrl}/api/v1/adjustment-cases/${caseId}/evidence/${evidenceId}`, {
    headers: {},
  });
  if (!res.ok) throw new ApiError(res.status, `Download failed (${res.status})`);
  return res.blob();
}
