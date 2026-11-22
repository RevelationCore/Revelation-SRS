import { createApiClient, ApiError } from '@revelation-srs/ui';

export { ApiError };

/** Where a 401 sends the browser: sign in again, then come back here (ADR-026). */
export function signInAgain(): void {
  window.location.href = `/login?returnTo=${encodeURIComponent(window.location.pathname + window.location.search)}`;
}

/** Core SRS, through this app's BFF (ADR-026): the BFF adds the access token. */
export const SRS_BASE = '/bff/srs';

export const api = createApiClient({ baseUrl: SRS_BASE, onUnauthorized: signInAgain });
