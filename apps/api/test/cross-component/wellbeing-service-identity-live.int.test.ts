/**
 * ADR-029 end to end against a real Keycloak (BL-332): the wellbeing
 * service's ServiceTokenProvider gets a token from the demo tenant's
 * srs-wellbeing-svc client in the development realm, and core validates it
 * with RS256 against Keycloak's keys and records the hand-off.
 *
 * Skipped unless KEYCLOAK_LIVE_URL names a Keycloak that imported
 * infra/compose/keycloak/srs-realm.json, for example:
 *   docker run -p 18082:8080 -e KC_BOOTSTRAP_ADMIN_USERNAME=admin -e KC_BOOTSTRAP_ADMIN_PASSWORD=admin \
 *     -v $PWD/infra/compose/keycloak:/opt/keycloak/data/import:ro quay.io/keycloak/keycloak:26.0.7 start-dev --import-realm
 *   KEYCLOAK_LIVE_URL=http://localhost:18082 pnpm --filter @revelation-srs/api exec vitest run --config vitest.int.config.ts test/cross-component/wellbeing-service-identity-live.int.test.ts
 */
import { DEFAULT_DEV_VLE_CLIENT_SECRET, DEFAULT_DEV_WELLBEING_CLIENT_SECRET, ServiceTokenProvider, vleConnectorClientId, wellbeingServiceClientId } from '@revelation-srs/auth';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { HttpSrsRegistryClient } from '../../../../adapters/vle/src/registry/client.js';
import { SrsAdjustmentHttpClient } from '../../../../modules/wellbeing/src/srs/srs-adjustment-client.js';
import { startTestApp, type TestApp } from '../helpers/test-app.js';

const kc = process.env['KEYCLOAK_LIVE_URL'];
const DEMO_TENANT = '00000000-0000-0000-0000-000000000001';

describe.skipIf(!kc)('wellbeing hand-off through a real Keycloak', () => {
  let ctx: TestApp;
  let srsUrl: string;

  beforeAll(async () => {
    ctx = await startTestApp({ auth: { keycloakJwksUrl: `${kc}/realms/srs/protocol/openid-connect/certs`, keycloakIssuer: `${kc}/realms/srs` } });
    await ctx.app.listen({ port: 0, host: '127.0.0.1' });
    srsUrl = `http://127.0.0.1:${(ctx.app.server.address() as { port: number }).port}`;
  }, 120_000);
  afterAll(async () => { await ctx?.teardown(); });

  it('records an approved adjustment with a token from the tenant\'s own client', async () => {
    expect(ctx.tenantId).toBe(DEMO_TENANT);
    // A staff record to attach the adjustment to, created directly (the app validates RS256 only).
    const { sql } = await import('drizzle-orm');
    const [person] = await ctx.db.execute(sql`INSERT INTO person (tenant_id, student_number) VALUES (${DEMO_TENANT}::uuid, 'LIVE-ADR029') RETURNING id`) as unknown as Array<{ id: string }>;
    const [enrolment] = await ctx.db.execute(sql`
      INSERT INTO enrolment (id, valid_from, tenant_id, person_id, status_code, mode_of_study_code, academic_year_of_entry, start_date)
      VALUES (gen_random_uuid(), now(), ${DEMO_TENANT}::uuid, ${person!.id}::uuid, 'enrolled', 'full-time', '2027-28', '2027-09-20') RETURNING id`) as unknown as Array<{ id: string }>;

    const tokens = new ServiceTokenProvider({ clientIdFor: wellbeingServiceClientId, tokenUrl: `${kc}/realms/srs/protocol/openid-connect/token`, auth: { method: 'client_secret_basic', secret: DEFAULT_DEV_WELLBEING_CLIENT_SECRET } });
    const client = new SrsAdjustmentHttpClient(srsUrl, tokens);
    const result = await client.submitAdjustment({
      tenantId: DEMO_TENANT, idempotencyKey: 'live-adr029-1', personId: person!.id, enrolmentId: enrolment!.id,
      adjustmentTypeCode: 'extra-time', scopeCode: 'exam', validFrom: '2027-09-01T00:00:00.000Z',
      amount: { value: 25, unitCode: 'percent-of-duration' }, sourceCaseId: '9a1b2c3d-0000-4000-8000-0000000000aa',
    });
    expect(result.adjustmentId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('the VLE connector reads its registration with a token from its own client (ADR-032)', async () => {
    // The app validates RS256 only, so create the registration through the service.
    const { registrationId } = await ctx.app.integrationRegistryService.createRegistration(DEMO_TENANT, {
      contractId: 'vle-adjustments.v1', transportCode: 'manual-api', endpointSafetyClass: 'simulator', liveTrafficApproved: false, replaySupported: false,
    }, 'live-test');
    const tokens = new ServiceTokenProvider({ clientIdFor: vleConnectorClientId, tokenUrl: `${kc}/realms/srs/protocol/openid-connect/token`, auth: { method: 'client_secret_basic', secret: DEFAULT_DEV_VLE_CLIENT_SECRET } });
    const registration = await new HttpSrsRegistryClient(srsUrl, tokens, DEMO_TENANT).getRegistration(registrationId);
    expect(registration.contractId).toBe('vle-adjustments.v1');
  });
});
