import { createApiClient, ApiError } from '@revelation-srs/ui';

export { ApiError };

const ACCESS_KEY = 'srs_portal_token';

export const api = createApiClient({
  baseUrl:        import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000',
  getToken:       () => localStorage.getItem(ACCESS_KEY),
  onUnauthorized: () => {
    localStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem('srs_portal_refresh_token');
    window.location.href = '/login';
  },
});
