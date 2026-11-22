/** The two cookies (ADR-026 item 4). __Host- means Secure, Path=/ and no Domain. */
export const SESSION_COOKIE = '__Host-srs_session';
export const LOGIN_COOKIE = '__Host-srs_login';

export function readCookie(header: string | undefined, name: string): string | undefined {
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return undefined;
}

export function sessionCookie(value: string): string {
  return `${SESSION_COOKIE}=${encodeURIComponent(value)}; HttpOnly; Secure; SameSite=Strict; Path=/`;
}

export function loginCookie(value: string): string {
  // Lax: the callback is a cross-site top-level navigation from Keycloak.
  return `${LOGIN_COOKIE}=${encodeURIComponent(value)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=600`;
}

export function clearCookie(name: string): string {
  return `${name}=; HttpOnly; Secure; SameSite=${name === LOGIN_COOKIE ? 'Lax' : 'Strict'}; Path=/; Max-Age=0`;
}
