const API_BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000';
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

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly detail?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = getStoredToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401) {
    clearToken();
    window.location.href = '/login';
    throw new ApiError(401, 'Session expired — please log in again');
  }

  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    let detail: string | undefined;
    try {
      const err = (await res.json()) as { title?: string; detail?: string };
      if (err.title) message = err.title;
      detail = err.detail;
    } catch { /* ignore parse errors */ }
    throw new ApiError(res.status, message, detail);
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  get:   <T>(path: string)                 => request<T>('GET',   path),
  post:  <T>(path: string, body?: unknown) => request<T>('POST',  path, body ?? {}),
  patch: <T>(path: string, body: unknown)  => request<T>('PATCH', path, body),
};
