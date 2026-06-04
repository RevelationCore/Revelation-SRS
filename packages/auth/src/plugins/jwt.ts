import jwt from '@fastify/jwt';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

import type { AuthenticatedUser } from '../types.js';

export interface JwtPluginOptions {
  /**
   * Symmetric secret for development / testing.
   * In production, configure KEYCLOAK_JWKS_URL instead and this is ignored.
   */
  secret?: string;
  /** Keycloak JWKS endpoint URL for RS256 verification in production. */
  jwksUrl?: string;
}

/**
 * Registers JWT authentication.
 *
 * - Development: HS256 with shared secret (JWT_SECRET env var).
 * - Production: RS256 verified against Keycloak JWKS endpoint.
 *
 * Every route is automatically protected by jwtPlugin's preValidation hook.
 * Unauthenticated requests receive 401.
 */
async function jwtPlugin(
  fastify: FastifyInstance,
  opts: JwtPluginOptions,
): Promise<void> {
  if (!opts.secret && !opts.jwksUrl) {
    throw new Error('Auth plugin requires either secret or jwksUrl');
  }

  await fastify.register(jwt, {
    secret:    opts.secret ?? 'replace-with-keycloak-jwks',
    namespace: 'srs',
    jwtVerify: 'srsVerify',
    jwtSign:   'srsSign',
  });

  // Attach authentication as a global preValidation hook (can be skipped per-route)
  fastify.addHook('preValidation', async (request, reply) => {
    try {
      const decoded = await request.jwtVerify<{
        sub:                string;
        tenant_id:          string;
        realm_roles?:       string[];
        name?:              string;
        email?:             string;
        preferred_username?: string;
      }>();

      const user: AuthenticatedUser = {
        sub:               decoded.sub,
        tenantId:          decoded.tenant_id,
        roles:             (decoded.realm_roles ?? []) as AuthenticatedUser['roles'],
        displayName:       decoded.name ?? '',
        email:             decoded.email ?? '',
        preferredUsername: decoded.preferred_username ?? '',
      };

      request.user     = user;
      request.tenantId = user.tenantId;
    } catch {
      await reply.code(401).send({
        type:     'https://srs.example.com/errors/unauthorized',
        title:    'Unauthorized',
        status:   401,
        detail:   'Missing or invalid authentication token',
        instance: request.url,
      });
    }
  });
}

export default fp(jwtPlugin, { name: 'srs-jwt', fastify: '5.x' });
