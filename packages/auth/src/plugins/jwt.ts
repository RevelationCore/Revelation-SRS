import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import jwt from '@fastify/jwt';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

import type { AuthenticatedUser } from '../types.js';
import { bindServiceRoles, SERVICE_ROLE_CLIENTS } from '../service-identity.js';

export interface JwtPluginOptions {
  /** Symmetric secret - development and test only (HS256). */
  secret?: string;
  /** Keycloak JWKS endpoint - staging and production (RS256). */
  jwksUrl?: string;
  /** Expected `iss`. Required with jwksUrl; checked in HS256 mode when given. */
  issuer?: string;
  /** Expected `aud` (this service). Required with jwksUrl; checked in HS256 mode when given. */
  audience?: string | string[];
  /** Allowed clock skew for exp/nbf/iat, in seconds. Default 30. */
  clockToleranceSeconds?: number;
}

type RawClaims = JWTPayload & {
  sub:                 string;
  tenant_id:           string;
  realm_roles?:        string[];
  name?:               string;
  email?:              string;
  preferred_username?: string;
  srs_person_id?:      string;
  /** Authorised party: the client the token was issued to (ADR-029). */
  azp?:                string;
  iss?:                string;
  aud?:                string | string[];
};

type SrsJwtRequest = {
  srsVerify<T>(): Promise<T>;
};

/**
 * JWT authentication plugin.
 *
 * Mode selection:
 *   - jwksUrl set -> RS256 only, validated against Keycloak's JWKS, with the
 *     issuer and audience pinned (production). Any other algorithm, issuer or
 *     audience is a 401.
 *   - secret set  -> HS256 only, symmetric secret (development / tests).
 *
 * Expiry and not-before are checked with a small clock tolerance (default
 * 30 s). Whether a service may start in HS256 mode at all is decided by its
 * config (see assertSecureAuthConfig).
 *
 * Routes that set `config: { skipAuth: true }` are exempted from the hook,
 * enabling health/readiness probes to remain unauthenticated.
 */
async function jwtPlugin(
  fastify: FastifyInstance,
  opts: JwtPluginOptions,
): Promise<void> {
  if (!opts.secret && !opts.jwksUrl) {
    throw new Error('srs-jwt: either secret or jwksUrl must be provided');
  }
  if (opts.jwksUrl && (!opts.issuer || !opts.audience || (Array.isArray(opts.audience) && opts.audience.length === 0))) {
    throw new Error('srs-jwt: jwksUrl needs the expected issuer and audience');
  }
  const clockToleranceSeconds = opts.clockToleranceSeconds ?? 30;
  const audiences = opts.audience === undefined ? [] : Array.isArray(opts.audience) ? opts.audience : [opts.audience];

  // Register @fastify/jwt for HS256 development mode and token signing in tests
  await fastify.register(jwt, {
    secret:    opts.secret ?? 'unused-when-jwks-is-active',
    namespace: 'srs',
    jwtVerify: 'srsVerify',
    jwtSign:   'srsSign',
    verify: {
      algorithms:     ['HS256'],
      clockTolerance: clockToleranceSeconds * 1000,
      ...(opts.issuer ? { allowedIss: opts.issuer } : {}),
      ...(audiences.length ? { allowedAud: audiences } : {}),
    },
  });

  // Build JWKS fetcher once for the lifetime of the process (handles key rotation)
  const jwks = opts.jwksUrl ? createRemoteJWKSet(new URL(opts.jwksUrl)) : null;
  const rs256Options = {
    algorithms:     ['RS256'],
    issuer:         opts.issuer!,
    audience:       audiences,
    clockTolerance: clockToleranceSeconds,
  };

  fastify.addHook('preValidation', async (request, reply) => {
    // Exempt probes and any route that explicitly opts out
    if (request.routeOptions.config?.skipAuth === true) return;

    const authHeader = request.headers.authorization;
    const token      = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

    if (!token) {
      return reply.code(401).send({
        type:     'https://srs.example.com/errors/unauthorized',
        title:    'Unauthorized',
        status:   401,
        detail:   'Missing Authorization header',
        instance: request.url,
      });
    }

    try {
      let claims: RawClaims;

      if (jwks) {
        // Production path - RS256 against Keycloak JWKS
        const { payload } = await jwtVerify<RawClaims>(token, jwks, rs256Options);
        claims = payload;
      } else {
        // Development path - HS256 symmetric secret
        claims = await (request as typeof request & SrsJwtRequest).srsVerify<RawClaims>();
      }

      if (!claims.sub || !claims.tenant_id) {
        throw new Error('JWT is missing required subject or tenant claim');
      }

      // A service role counts only from that service's own client for this
      // tenant (ADR-029): a mismatch fails closed by dropping the role.
      const bound = bindServiceRoles(claims.realm_roles ?? [], { tenantId: claims.tenant_id, azp: claims.azp, srsPersonId: claims.srs_person_id });
      if (bound.dropped.length > 0) request.log.warn({ dropped: bound.dropped, azp: claims.azp }, 'service role ignored: not from its own client for this tenant');
      const isService = bound.roles.some((r) => r in SERVICE_ROLE_CLIENTS);

      const user: AuthenticatedUser = {
        sub:               claims.sub,
        tenantId:          claims.tenant_id,
        roles:             bound.roles as AuthenticatedUser['roles'],
        // Service tokens carry no name: audit shows the client instead.
        displayName:       claims.name ?? (isService ? claims.azp ?? '' : ''),
        email:             claims.email ?? '',
        preferredUsername: claims.preferred_username ?? '',
        ...(claims.srs_person_id ? { srsPersonId: claims.srs_person_id } : {}),
        ...(claims.azp ? { authorizedParty: claims.azp } : {}),
      };

      request.user     = user;
      request.tenantId = user.tenantId;
    } catch {
      return reply.code(401).send({
        type:     'https://srs.example.com/errors/unauthorized',
        title:    'Unauthorized',
        status:   401,
        detail:   'Invalid or expired token',
        instance: request.url,
      });
    }
  });
}

export default fp(jwtPlugin, { name: 'srs-jwt', fastify: '5.x' });
