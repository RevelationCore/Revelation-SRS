import { DEFAULT_DEV_JWT_SECRET, tokenEnv } from '@revelation-srs/auth';

import { loadSrsHandoffConfig, type SrsHandoffConfig } from './srs/handoff-config.js';

export interface Config {
  port:            number;
  logLevel:        string;
  nodeEnv:         string;
  databaseUrl:     string;
  srsApiUrl:       string;
  natsUrl:         string;
  jwtSecret:       string;
  keycloakJwksUrl: string | undefined;
  /** Expected token issuer; defaults to the realm the JWKS URL sits under. */
  keycloakIssuer?: string | undefined;
  /** Expected token audience; defaults to 'srs-wellbeing'. */
  keycloakAudience?: string[] | undefined;
  /** Allowed clock skew for token expiry, in seconds (default 30). */
  jwtClockToleranceSeconds?: number | undefined;
  corsOrigins:     string[];
  /** The hand-offs to core (ADR-029); read from the environment when omitted. */
  srsHandoff?:     SrsHandoffConfig;
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Required environment variable ${name} is not set`);
  return v;
}

function optionalInt(name: string, defaultValue: number): number {
  const v = process.env[name];
  return v ? parseInt(v, 10) : defaultValue;
}

export function loadConfig(): Config {
  return {
    port:            optionalInt('WELLBEING_PORT', 3002),
    logLevel:        process.env['LOG_LEVEL'] ?? 'info',
    nodeEnv:         process.env['NODE_ENV'] ?? 'development',
    databaseUrl:     required('DATABASE_URL'),
    srsApiUrl:       process.env['SRS_API_URL'] ?? 'http://localhost:3000',
    natsUrl:         process.env['NATS_URL'] ?? 'nats://localhost:4222',
    jwtSecret:       process.env['JWT_SECRET'] ?? DEFAULT_DEV_JWT_SECRET,  // development and test only (assertSecureAuthConfig)
    keycloakJwksUrl: process.env['KEYCLOAK_JWKS_URL'],
    ...tokenEnv(),
    corsOrigins:     (process.env['CORS_ORIGINS'] ?? 'http://localhost:5173').split(','),
    srsHandoff:      loadSrsHandoffConfig(process.env['NODE_ENV'] ?? 'development'),
  };
}
