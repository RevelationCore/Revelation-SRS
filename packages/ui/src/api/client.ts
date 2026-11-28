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

/**
 * Calls go to the BFF on this origin (ADR-026), which adds the access token:
 * the browser sends only its session cookie and the CSRF header.
 */
export interface ApiClientConfig {
  /** '/bff/srs' or '/bff/wellbeing'. */
  baseUrl:        string;
  onUnauthorized?: () => void;
}

/** fetch through the BFF: same-origin cookie and the CSRF header; a 401 means sign in again. */
export async function bffFetch(input: string, init: RequestInit = {}, onUnauthorized?: () => void): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('X-SRS-Request', '1');
  const res = await fetch(input, { ...init, headers, credentials: 'same-origin' });
  if (res.status === 401) onUnauthorized?.();
  return res;
}

async function parseError(res: Response): Promise<{ message: string; detail?: string }> {
  try {
    const body = (await res.json()) as { title?: string; detail?: string };
    return { message: body.title ?? `Request failed (${res.status})`, detail: body.detail };
  } catch {
    return { message: `Request failed (${res.status})` };
  }
}

export function createApiClient({ baseUrl, onUnauthorized }: ApiClientConfig) {
  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await bffFetch(`${baseUrl}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    if (res.status === 401) {
      onUnauthorized?.();
      const { message, detail } = await parseError(res);
      throw new ApiError(401, message, detail);
    }

    if (!res.ok) {
      const { message, detail } = await parseError(res);
      throw new ApiError(res.status, message, detail);
    }

    if (res.status === 204) return undefined as T;
    return res.json() as Promise<T>;
  }

  return {
    get:    <T>(path: string)                 => request<T>('GET',    path),
    post:   <T>(path: string, body?: unknown) => request<T>('POST',   path, body ?? {}),
    patch:  <T>(path: string, body: unknown)  => request<T>('PATCH',  path, body),
    put:    <T>(path: string, body: unknown)  => request<T>('PUT',    path, body),
    delete: <T>(path: string)                 => request<T>('DELETE', path),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
