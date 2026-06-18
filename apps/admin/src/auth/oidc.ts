/** PKCE Authorization Code Flow helpers — no external OIDC library required. */

export interface OidcConfig {
  keycloakUrl: string;
  realm:       string;
  clientId:    string;
  redirectUri: string;
}

/** Build the OIDC config from Vite env vars; null when Keycloak is not configured. */
export const oidcConfig: OidcConfig | null =
  import.meta.env.VITE_KEYCLOAK_URL
    ? {
        keycloakUrl: import.meta.env.VITE_KEYCLOAK_URL,
        realm:       import.meta.env.VITE_KEYCLOAK_REALM     ?? 'srs',
        clientId:    import.meta.env.VITE_KEYCLOAK_CLIENT_ID ?? 'srs-admin',
        redirectUri: `${window.location.origin}/callback`,
      }
    : null;

// ── PKCE helpers ──────────────────────────────────────────────────────────────

function base64urlEncode(bytes: Uint8Array): string {
  let str = '';
  for (let i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i]!);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function generateRandom(): string {
  const buf = new Uint8Array(32);
  crypto.getRandomValues(buf);
  return base64urlEncode(buf);
}

async function sha256(plain: string): Promise<string> {
  const data   = new TextEncoder().encode(plain);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return base64urlEncode(new Uint8Array(digest));
}

// ── Public API ────────────────────────────────────────────────────────────────

const VERIFIER_KEY = 'srs_pkce_verifier';
const STATE_KEY    = 'srs_pkce_state';

/**
 * Begin the OIDC login: generate PKCE verifier + challenge, persist them to
 * sessionStorage, then redirect the browser to the Keycloak authorization
 * endpoint.
 */
export async function startLogin(cfg: OidcConfig): Promise<void> {
  const verifier   = generateRandom();
  const challenge  = await sha256(verifier);
  const state      = generateRandom();

  sessionStorage.setItem(VERIFIER_KEY, verifier);
  sessionStorage.setItem(STATE_KEY,    state);

  const params = new URLSearchParams({
    response_type:          'code',
    client_id:              cfg.clientId,
    redirect_uri:           cfg.redirectUri,
    scope:                  'openid profile',
    code_challenge:         challenge,
    code_challenge_method:  'S256',
    state,
  });

  window.location.href =
    `${cfg.keycloakUrl}/realms/${cfg.realm}/protocol/openid-connect/auth?${params.toString()}`;
}

/**
 * Complete the OIDC login: validate state, exchange the authorization code for
 * an access token, and return it.  Throws on any failure.
 */
export async function handleCallback(
  cfg:   OidcConfig,
  code:  string,
  state: string,
): Promise<string> {
  const storedState    = sessionStorage.getItem(STATE_KEY);
  const storedVerifier = sessionStorage.getItem(VERIFIER_KEY);

  sessionStorage.removeItem(STATE_KEY);
  sessionStorage.removeItem(VERIFIER_KEY);

  if (!storedState || !storedVerifier) {
    throw new Error('No PKCE session found — please start the login flow again.');
  }
  if (state !== storedState) {
    throw new Error('State mismatch — possible CSRF attempt.');
  }

  const body = new URLSearchParams({
    grant_type:    'authorization_code',
    client_id:     cfg.clientId,
    redirect_uri:  cfg.redirectUri,
    code,
    code_verifier: storedVerifier,
  });

  const res = await fetch(
    `${cfg.keycloakUrl}/realms/${cfg.realm}/protocol/openid-connect/token`,
    {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    body.toString(),
    },
  );

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Token exchange failed (${res.status}): ${text}`);
  }

  const data = (await res.json()) as { access_token: string };
  return data.access_token;
}

/**
 * Redirect to Keycloak's RP-Initiated Logout endpoint, which clears the
 * Keycloak session and then redirects back to the app login page.
 */
export function logout(cfg: OidcConfig): void {
  const params = new URLSearchParams({
    client_id:               cfg.clientId,
    post_logout_redirect_uri: `${window.location.origin}/login`,
  });
  window.location.href =
    `${cfg.keycloakUrl}/realms/${cfg.realm}/protocol/openid-connect/logout?${params.toString()}`;
}
