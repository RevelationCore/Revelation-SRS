import { createHash } from 'node:crypto';

import { Type } from '@sinclair/typebox';
import { tenants } from '@revelation-srs/db';
import { NotFoundError } from '@revelation-srs/domain';
import { eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';

import { VerificationSchema, resultToWire } from './award-documents.js';

const ErrorSchema = Type.Object({ type: Type.String(), title: Type.String(), status: Type.Number(), detail: Type.Optional(Type.String()) });

/**
 * Verification without an account (Phase 3 D-21). Public checks work only
 * from what the holder chose to share: the verification code, or the PDF
 * itself (hashed and not kept). Rate-limited per IP; each check is logged
 * with a salted hash of the IP, never the IP. A not-found check answers in
 * the same way and the same time as any other. The tenant's public signing
 * keys are published here too (D-20).
 */
export function publicVerificationRoutes(fastify: FastifyInstance): void {
  const limit = { rateLimit: { max: Number(process.env['PUBLIC_VERIFY_RATE_LIMIT'] ?? 30), timeWindow: 60_000, keyGenerator: (req: FastifyRequest) => req.ip } };
  const salt = process.env['PUBLIC_VERIFY_IP_SALT'] ?? 'srs-public-verify';
  const ipHash = (req: FastifyRequest) => createHash('sha256').update(`${salt}:${req.ip}`).digest('hex');

  fastify.addContentTypeParser('application/pdf', { parseAs: 'buffer', bodyLimit: 15 * 1024 * 1024 }, (_req, body, done) => done(null, body));

  const tenantFor = async (tenantCode: string) => {
    const [row] = await fastify.db.select({ id: tenants.id, configuration: tenants.configuration }).from(tenants).where(eq(tenants.code, tenantCode)).limit(1);
    if (!row) throw new NotFoundError('Institution', tenantCode);
    const docs = ((row.configuration ?? {})['documents'] ?? {}) as Record<string, unknown>;
    const settings = (docs['publicVerification'] ?? {}) as Record<string, unknown>;
    return { tenantId: row.id, enabled: settings['enabled'] !== false, discloseFacts: settings['discloseFacts'] !== false };
  };
  const disabled = { type: 'https://srs.example.com/errors/not-found', title: 'Not found', status: 404, detail: 'Public verification is not offered by this institution' };

  fastify.get('/verify/:tenantCode/:code', {
    schema: { params: Type.Object({ tenantCode: Type.String({ maxLength: 64 }), code: Type.String({ minLength: 4, maxLength: 64 }) }), response: { 200: VerificationSchema, 404: ErrorSchema } },
    config: { skipAuth: true, ...limit },
  }, async (request, reply) => {
    const { tenantCode, code } = request.params as { tenantCode: string; code: string };
    const tenant = await tenantFor(tenantCode);
    if (!tenant.enabled) return reply.code(404).send(disabled);
    const started = Date.now();
    const result = await fastify.awardDocumentService.verify(tenant.tenantId, code, 'public', undefined, { ipHash: ipHash(request), discloseFacts: tenant.discloseFacts });
    await uniformDelay(started);
    return reply.send(resultToWire(result));
  });

  fastify.post('/verify/:tenantCode/file', {
    schema: { params: Type.Object({ tenantCode: Type.String({ maxLength: 64 }) }), response: { 200: VerificationSchema, 404: ErrorSchema, 415: ErrorSchema } },
    config: { skipAuth: true, ...limit },
  }, async (request, reply) => {
    const { tenantCode } = request.params as { tenantCode: string };
    const tenant = await tenantFor(tenantCode);
    if (!tenant.enabled) return reply.code(404).send(disabled);
    if (!Buffer.isBuffer(request.body)) {
      return reply.code(415).send({ type: 'https://srs.example.com/errors/unsupported-media-type', title: 'Unsupported Media Type', status: 415, detail: 'Send the PDF with content-type application/pdf' });
    }
    const started = Date.now();
    const result = await fastify.awardDocumentService.verifyFile(tenant.tenantId, request.body, 'public', { ipHash: ipHash(request), discloseFacts: tenant.discloseFacts });
    await uniformDelay(started);
    return reply.send(resultToWire(result));
  });

  fastify.get('/keys/:tenantCode', {
    schema: { params: Type.Object({ tenantCode: Type.String({ maxLength: 64 }) }) },
    config: { skipAuth: true, ...limit },
  }, async (request, reply) => {
    const { tenantCode } = request.params as { tenantCode: string };
    const tenant = await tenantFor(tenantCode);
    await reply.header('cache-control', 'public, max-age=300').send(await fastify.awardDocumentService.jwks(tenant.tenantId));
  });
}

/** Answers no sooner than a fixed time, so a found and a not-found code take the same time. */
async function uniformDelay(started: number, floorMs = 150): Promise<void> {
  const wait = floorMs - (Date.now() - started);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
}
