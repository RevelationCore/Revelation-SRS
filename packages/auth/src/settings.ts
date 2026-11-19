import type { JwtPluginOptions } from './plugins/jwt.js';

/** The token settings every service reads from its environment. */
export interface AuthSettings {
  jwtSecret:        string;
  keycloakJwksUrl:  string | undefined;
  /** Expected `iss`; defaults to the realm URL the JWKS URL sits under. */
  keycloakIssuer?:  string | undefined;
  /** Expected `aud`; defaults to the service's own audience. */
  keycloakAudience?: string[] | undefined;
  /** Allowed clock skew for exp/nbf/iat, in seconds. */
  jwtClockToleranceSeconds?: number | undefined;
}

/** Reads KEYCLOAK_ISSUER, KEYCLOAK_AUDIENCE (comma-separated) and JWT_CLOCK_TOLERANCE_SECONDS. */
export function tokenEnv(env: NodeJS.ProcessEnv = process.env): Pick<AuthSettings, 'keycloakIssuer' | 'keycloakAudience' | 'jwtClockToleranceSeconds'> {
  const audience = env['KEYCLOAK_AUDIENCE']?.split(',').map((a) => a.trim()).filter(Boolean);
  const tolerance = env['JWT_CLOCK_TOLERANCE_SECONDS'];
  return {
    keycloakIssuer:   env['KEYCLOAK_ISSUER'] || undefined,
    keycloakAudience: audience?.length ? audience : undefined,
    jwtClockToleranceSeconds: tolerance ? Number.parseInt(tolerance, 10) : undefined,
  };
}

/** `http://kc/realms/srs/protocol/openid-connect/certs` → `http://kc/realms/srs`. */
export function issuerFromJwksUrl(jwksUrl: string): string {
  return jwksUrl.replace(/\/protocol\/openid-connect\/certs\/?$/, '');
}

/**
 * jwtPlugin options for a service: RS256 against Keycloak with the issuer and
 * this service's audience pinned, or HS256 with the shared secret.
 */
export function jwtPluginOptions(settings: AuthSettings, serviceAudience: string): JwtPluginOptions {
  const clockToleranceSeconds = settings.jwtClockToleranceSeconds ?? 30;
  if (settings.keycloakJwksUrl) {
    return {
      jwksUrl:  settings.keycloakJwksUrl,
      issuer:   settings.keycloakIssuer ?? issuerFromJwksUrl(settings.keycloakJwksUrl),
      audience: settings.keycloakAudience ?? [serviceAudience],
      clockToleranceSeconds,
    };
  }
  return {
    secret: settings.jwtSecret,
    clockToleranceSeconds,
    ...(settings.keycloakIssuer ? { issuer: settings.keycloakIssuer } : {}),
    ...(settings.keycloakAudience ? { audience: settings.keycloakAudience } : {}),
  };
}
