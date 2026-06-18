export interface JwtPayload {
  sub:                 string;
  preferred_username?: string;
  name?:               string;
  given_name?:         string;
  family_name?:        string;
  email?:              string;
  realm_access?:       { roles: string[] };
  exp:                 number;
  iat:                 number;
  tenant_id?:          string;
}

export function parseJwt(token: string): JwtPayload {
  const parts = token.split('.');
  if (parts.length !== 3 || !parts[1]) throw new Error('Invalid JWT format');
  const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64.padEnd(base64.length + (4 - (base64.length % 4)) % 4, '=');
  return JSON.parse(atob(padded)) as JwtPayload;
}

export function isTokenExpired(token: string): boolean {
  try {
    return Date.now() / 1000 >= parseJwt(token).exp;
  } catch {
    return true;
  }
}

export function secondsUntilExpiry(token: string): number {
  try {
    return Math.floor(parseJwt(token).exp - Date.now() / 1000);
  } catch {
    return 0;
  }
}

export function getTokenRoles(token: string): string[] {
  try {
    return parseJwt(token).realm_access?.roles ?? [];
  } catch {
    return [];
  }
}

export function getDisplayName(payload: JwtPayload): string {
  const fullName = [payload.given_name, payload.family_name].filter(Boolean).join(' ');
  return (
    payload.name ??
    (fullName || null) ??
    payload.preferred_username ??
    payload.email ??
    payload.sub
  );
}
