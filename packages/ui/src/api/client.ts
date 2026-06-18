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

export interface ApiClientConfig {
  baseUrl:        string;
  getToken:       () => string | null;
  onUnauthorized?: () => void;
}

async function parseError(res: Response): Promise<{ message: string; detail?: string }> {
  try {
    const body = (await res.json()) as { title?: string; detail?: string };
    return { message: body.title ?? `Request failed (${res.status})`, detail: body.detail };
  } catch {
    return { message: `Request failed (${res.status})` };
  }
}

export function createApiClient({ baseUrl, getToken, onUnauthorized }: ApiClientConfig) {
  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const token   = getToken();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
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
