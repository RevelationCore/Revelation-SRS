import { createApiClient, ApiError } from '@revelation-srs/ui';

export { ApiError };

const TOKEN_KEY = 'srs_admin_token';

export function getStoredToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function storeToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

export const api = createApiClient({
  baseUrl:       import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000',
  getToken:      getStoredToken,
  onUnauthorized: () => {
    clearToken();
    window.location.href = '/login';
  },
});
