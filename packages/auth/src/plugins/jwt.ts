import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import jwt from '@fastify/jwt';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

import type { AuthenticatedUser } from '../types.js';

export interface JwtPluginOptions {
  /** Symmetric secret - development and test only (HS256). */
  secret?: string;
  /** Keycloak JWKS endpoint - staging and production (RS256). */
  jwksUrl?: string;
}

type RawClaims = JWTPayload & {
  sub:                 string;
  tenant_id:           string;
  realm_roles?:        string[];
  name?:               string;
  email?:              string;
  preferred_username?: string;
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
 *   - jwksUrl set -> RS256, validates against Keycloak JWKS (production).
 *   - secret set  -> HS256, symmetric secret (development / tests).
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

  // Register @fastify/jwt for HS256 development mode and token signing in tests
  await fastify.register(jwt, {
    secret:    opts.secret ?? 'unused-when-jwks-is-active',
    namespace: 'srs',
    jwtVerify: 'srsVerify',
    jwtSign:   'srsSign',
  });

  // Build JWKS fetcher once for the lifetime of the process (handles key rotation)
  const jwks = opts.jwksUrl ? createRemoteJWKSet(new URL(opts.jwksUrl)) : null;

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
        const { payload } = await jwtVerify<RawClaims>(token, jwks);
        claims = payload;
      } else {
        // Development path - HS256 symmetric secret
        claims = await (request as typeof request & SrsJwtRequest).srsVerify<RawClaims>();
      }

      if (!claims.sub || !claims.tenant_id) {
        throw new Error('JWT is missing required subject or tenant claim');
      }

      const user: AuthenticatedUser = {
        sub:               claims.sub,
        tenantId:          claims.tenant_id,
        roles:             (claims.realm_roles ?? []) as AuthenticatedUser['roles'],
        displayName:       claims.name ?? '',
        email:             claims.email ?? '',
        preferredUsername: claims.preferred_username ?? '',
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
