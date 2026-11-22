import { bindServiceRoles, vleConnectorClientId, wellbeingServiceClientId } from '@revelation-srs/auth';
import { PERMISSION_ROLES } from '@revelation-srs/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startTestApp, type TestApp } from './helpers/test-app.js';

/**
 * ADR-032 (BL-364, guard BL-368): the VLE connector calls core as
 * srs-vle-svc-<tenant> with the vle-connector-service role, which holds three
 * VLE-only permissions in place of integration:manage and mark:write.
 */

let ctx: TestApp;
let admin: string;
let registry: string;
let connector: string;

beforeAll(async () => {
  ctx = await startTestApp();
  admin = await ctx.makeJwt({ roles: ['tenant-administrator'] });
  registry = await ctx.makeJwt({ roles: ['registry-administrator'] });
  connector = await ctx.makeJwt({ sub: 'service-account-srs-vle-svc', name: null, roles: ['vle-connector-service'], azp: vleConnectorClientId(ctx.tenantId) });
}, 120_000);
afterAll(async () => { await ctx?.teardown(); });

async function call(token: string, method: 'GET' | 'POST' | 'PUT' | 'PATCH', url: string, payload?: Record<string, unknown>) {
  return ctx.app.inject({ method, url: `/api/v1${url}`, headers: { authorization: `Bearer ${token}` }, ...(payload ? { payload } : {}) });
}

async function registration(contractId: string): Promise<string> {
  const res = await call(admin, 'POST', '/integration-registrations', {
    contractId, transportCode: 'manual-api', endpointSafetyClass: 'simulator', liveTrafficApproved: false, replaySupported: false, secretRef: 'kv/data/srs/vle-adapter',
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json<{ registrationId: string }>().registrationId;
}

/** A student registered on a module with one exam component. */
async function registered(code: string): Promise<{ personId: string; enrolmentId: string; moduleRegistrationId: string; componentId: string }> {
  const post = async (url: string, payload: Record<string, unknown>) => {
    const res = await call(registry, 'POST', url, payload);
    expect(res.statusCode, `${url}: ${res.body}`).toBe(201);
    return res.json<Record<string, string>>();
  };
  const { personId } = await post('/students', { legalFirstName: code, legalFamilyName: 'Vle' });
  const { enrolmentId } = await post('/enrolments', { personId, modeOfStudyCode: 'full-time', academicYearOfEntry: '2026-27', startDate: '2026-09-21' });
  const { moduleId } = await post('/modules', { code, title: `${code} Module`, creditValue: 20 });
  const { academicPeriodId } = await post('/academic-periods', { academicYear: '2026-27', periodCode: `${code}-S1`, periodTypeCode: 'semester', startDate: '2026-09-21', endDate: '2027-01-15' });
  const { moduleOfferingId } = await post('/module-offerings', { moduleId, academicPeriodId, deliveryModeCode: 'in-person', capacity: 100 });
  const component = await post(`/module-offerings/${moduleOfferingId}/components`, { componentTypeCode: 'coursework', title: 'Essay', weighting: 100 });
  const { moduleRegistrationId } = await post('/module-registrations', { enrolmentId, moduleOfferingId, registrationDate: '2026-10-01', validFrom: '2026-10-01T00:00:00.000Z' });
  return { personId, enrolmentId, moduleRegistrationId: moduleRegistrationId!, componentId: (component['assessmentComponentId'] ?? component['componentId'])! };
}

async function distributions(personId: string, enrolmentId: string): Promise<{ adjustmentId: string; byTarget: Record<string, { distributionId: string }> }> {
  const res = await call(registry, 'POST', `/students/${personId}/adjustments`, {
    enrolmentId, adjustmentTypeCode: 'extra-time', scopeCode: 'all', validFrom: '2027-09-01T00:00:00.000Z', amount: { value: 25, unitCode: 'percent-of-duration' },
  });
  expect(res.statusCode, res.body).toBe(201);
  const { adjustmentId } = res.json<{ adjustmentId: string }>();
  const list = (await call(registry, 'GET', `/adjustments/${adjustmentId}/distributions`)).json<Array<{ distributionId: string; targetSystem: string }>>();
  return { adjustmentId, byTarget: Object.fromEntries(list.map((d) => [d.targetSystem, d])) };
}

describe('the vle-connector-service role', () => {
  it('holds the three VLE-only permissions, which no other role holds', () => {
    const held = Object.entries(PERMISSION_ROLES).filter(([, roles]) => (roles as string[]).includes('vle-connector-service')).map(([p]) => p).sort();
    expect(held).toEqual(['adjustment-distribution:reply:vle', 'integration-registration:use:vle', 'mark:record-from-vle']);
    for (const p of held) expect(PERMISSION_ROLES[p as keyof typeof PERMISSION_ROLES]).toEqual(['vle-connector-service']);
  });

  it('is honoured only from the tenant\'s own srs-vle-svc client, on a token naming no person', () => {
    const tenantId = '00000000-0000-0000-0000-0000000000aa';
    expect(bindServiceRoles(['vle-connector-service'], { tenantId, azp: vleConnectorClientId(tenantId) }).roles).toEqual(['vle-connector-service']);
    expect(bindServiceRoles(['vle-connector-service'], { tenantId, azp: vleConnectorClientId('another-tenant') }).roles).toEqual([]);
    expect(bindServiceRoles(['vle-connector-service'], { tenantId, azp: wellbeingServiceClientId(tenantId) }).roles).toEqual([]);
    expect(bindServiceRoles(['vle-connector-service'], { tenantId, azp: 'srs-admin' }).roles).toEqual([]);
    expect(bindServiceRoles(['vle-connector-service'], { tenantId, azp: vleConnectorClientId(tenantId), srsPersonId: 'p' }).roles).toEqual([]);
  });
});

describe('integration registrations', () => {
  it('reads and reports health for a VLE registration, without its secret reference', async () => {
    const id = await registration('vle-adjustments.v1');
    const res = await call(connector, 'GET', `/integration-registrations/${id}`);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json<{ secretRef: string | null }>().secretRef).toBeNull();
    expect((await call(admin, 'GET', `/integration-registrations/${id}`)).json<{ secretRef: string | null }>().secretRef).toBe('kv/data/srs/vle-adapter');
    const health = await call(connector, 'POST', `/integration-registrations/${id}/health-check`, { statusCode: 'healthy' });
    expect(health.statusCode, health.body).toBe(200);
  });

  it('sees any other contract as not found, and cannot enable or disable registrations', async () => {
    const other = await registration('exam-scheduling.v1');
    expect((await call(connector, 'GET', `/integration-registrations/${other}`)).statusCode).toBe(404);
    expect((await call(connector, 'POST', `/integration-registrations/${other}/health-check`, { statusCode: 'healthy' })).statusCode).toBe(404);
    const vle = await registration('vle-course-provisioning.v1');
    expect((await call(connector, 'POST', `/integration-registrations/${vle}/disable`)).statusCode).toBe(403);
    expect((await call(connector, 'POST', `/integration-registrations/${vle}/enable`)).statusCode).toBe(403);
    expect((await call(connector, 'GET', '/integration-registrations')).statusCode).toBe(403);
  });
});

describe('mark passback', () => {
  it('records a VLE mark once per submission reference, and refuses anything else', async () => {
    const f = await registered('VLEMK');
    const mark = (extra: Record<string, unknown>) => call(connector, 'POST', `/module-registrations/${f.moduleRegistrationId}/marks`, { assessmentComponentId: f.componentId, rawMark: 64, ...extra });

    expect((await mark({ sourceSystem: 'turnitin', sourceReference: 'sub-1' })).statusCode).toBe(422);
    expect((await mark({ sourceSystem: 'vle' })).statusCode).toBe(422);
    expect((await mark({})).statusCode).toBe(422);

    const first = await mark({ sourceSystem: 'vle', sourceReference: 'moodle-sub-1' });
    expect(first.statusCode, first.body).toBe(201);
    const repeat = await mark({ sourceSystem: 'vle', sourceReference: 'moodle-sub-1' });
    expect(repeat.statusCode, repeat.body).toBe(200);
    expect(repeat.json<{ markId: string }>().markId).toBe(first.json<{ markId: string }>().markId);

    expect((await call(connector, 'PATCH', `/marks/${first.json<{ markId: string }>().markId}`, { rawMark: 99, reason: 'no' })).statusCode).toBe(403);
  });

  it('leaves staff mark entry as it was', async () => {
    const f = await registered('VLESTAFF');
    const res = await call(registry, 'POST', `/module-registrations/${f.moduleRegistrationId}/marks`, { assessmentComponentId: f.componentId, rawMark: 55 });
    expect(res.statusCode, res.body).toBe(201);
  });
});

describe('adjustment replies', () => {
  it('acknowledges a connected VLE distribution, and nothing for another target', async () => {
    const f = await registered('VLEADJ');
    const { adjustmentId, byTarget } = await distributions(f.personId, f.enrolmentId);
    const reply = (target: string, distributionId: string) =>
      call(connector, 'POST', `/adjustments/${adjustmentId}/distributions/${distributionId}/acknowledge`, { targetSystem: target });

    expect((await reply('attendance', byTarget['attendance']!.distributionId)).statusCode).toBe(404);
    expect((await reply('vle', byTarget['attendance']!.distributionId)).statusCode).toBe(404);
    const ok = await reply('vle', byTarget['vle']!.distributionId);
    expect(ok.statusCode, ok.body).toBe(204);
  });

  it('does not reply for a VLE distribution fulfilled by hand', async () => {
    const setMode = (mode: string) => call(admin, 'PUT', '/adjustment-targets/vle', { fulfilmentModeCode: mode });
    expect((await setMode('manual')).statusCode).toBe(200);
    try {
      const f = await registered('VLEMAN');
      const { adjustmentId, byTarget } = await distributions(f.personId, f.enrolmentId);
      const res = await call(connector, 'POST', `/adjustments/${adjustmentId}/distributions/${byTarget['vle']!.distributionId}/acknowledge`, { targetSystem: 'vle' });
      expect(res.statusCode, res.body).toBe(409);
    } finally {
      expect((await setMode('connected')).statusCode).toBe(200);
    }
  });
});
