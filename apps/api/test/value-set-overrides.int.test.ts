import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startTestApp, type TestApp } from './helpers/test-app.js';

/**
 * Institutions relabel and hide platform values. The code never changes:
 * a relabel changes the wording one tenant sees, a hide takes the value out
 * of that tenant's pickers but it still labels records and still validates.
 * Lifecycle status sets can be relabelled but not hidden.
 */

interface Member { code: string; displayLabel: string; description: string | null; active: boolean; hidden: boolean; selectable: boolean }
interface Managed extends Member { isTenantOwned: boolean; platformLabel: string; overridden: boolean; overrideUpdatedBy: string | null }

let ctx: TestApp;
let admin: string;
let otherAdmin: string;
let registry: string;

async function call<T>(jwt: string, method: 'GET' | 'PUT' | 'DELETE' | 'POST', url: string, payload?: unknown) {
  const res = await ctx.app.inject({ method, url: `/api/v1${url}`, headers: { authorization: `Bearer ${jwt}` }, ...(payload !== undefined ? { payload: payload as object } : {}) });
  return { status: res.statusCode, body: (res.body ? res.json() : undefined) as T };
}

const fieldSet = (jwt: string, include?: 'all') =>
  call<{ setCode: string; entityName: string; members: Member[] }>(jwt, 'GET', `/fields/enrolment/mode_of_study_code/value-set${include ? '?include=all' : ''}`);

beforeAll(async () => {
  ctx = await startTestApp();
  admin = await ctx.makeJwt({ roles: ['tenant-administrator'] });
  otherAdmin = await ctx.makeJwt({ roles: ['tenant-administrator'], tenantId: ctx.secondTenantId });
  registry = await ctx.makeJwt();
}, 120_000);

afterAll(async () => {
  await ctx?.teardown();
});

describe('relabelling a platform value', () => {
  it('changes the wording for this institution only, keeping the code and the platform label', async () => {
    const res = await call<Managed>(admin, 'PUT', '/value-sets/mode-of-study-code/members/part-time/override', {
      displayLabel: 'Part-time (evening)', description: 'Taught in the evenings',
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      code: 'part-time', displayLabel: 'Part-time (evening)', description: 'Taught in the evenings',
      platformLabel: 'Part-time', overridden: true, hidden: false, isTenantOwned: false, overrideUpdatedBy: 'test-user-001',
    });

    const mine = (await fieldSet(registry)).body.members.find((m) => m.code === 'part-time');
    expect(mine?.displayLabel).toBe('Part-time (evening)');
    const theirs = (await fieldSet(otherAdmin)).body.members.find((m) => m.code === 'part-time');
    expect(theirs?.displayLabel).toBe('Part-time');
  });

  it('restores the platform wording when the override is removed', async () => {
    const res = await call<Managed>(admin, 'DELETE', '/value-sets/mode-of-study-code/members/part-time/override');
    expect(res.body).toMatchObject({ displayLabel: 'Part-time', overridden: false });
    expect((await fieldSet(registry)).body.members.find((m) => m.code === 'part-time')?.displayLabel).toBe('Part-time');
  });
});

describe('hiding a platform value', () => {
  it('leaves pickers but still labels and validates', async () => {
    const res = await call<Managed>(admin, 'PUT', '/value-sets/mode-of-study-code/members/sandwich/override', { hidden: true });
    expect(res.body).toMatchObject({ code: 'sandwich', hidden: true, selectable: false, overridden: true });

    const picker = (await fieldSet(registry)).body.members.map((m) => m.code);
    expect(picker).not.toContain('sandwich');
    expect(picker).toContain('full-time');

    const all = (await fieldSet(registry, 'all')).body.members.find((m) => m.code === 'sandwich');
    expect(all).toMatchObject({ displayLabel: expect.any(String) as string, hidden: true, selectable: false, active: true });

    expect(await ctx.app.valueSetService.validateFieldValue('enrolment', 'mode_of_study_code', 'sandwich', ctx.tenantId)).toBe(true);
    // Not hidden for anyone else.
    expect((await fieldSet(otherAdmin)).body.members.map((m) => m.code)).toContain('sandwich');
  });

  it('shows it again when un-hidden, and a hidden relabel keeps its wording', async () => {
    await call(admin, 'PUT', '/value-sets/mode-of-study-code/members/sandwich/override', { displayLabel: 'Sandwich year', hidden: false });
    const m = (await fieldSet(registry)).body.members.find((x) => x.code === 'sandwich');
    expect(m).toMatchObject({ displayLabel: 'Sandwich year', selectable: true });
  });

  it('refuses to hide a lifecycle status the system writes, but allows relabelling it', async () => {
    const hide = await call<{ detail: string }>(admin, 'PUT', '/value-sets/enrolment-status-code/members/withdrawn/override', { hidden: true });
    expect(hide.status).toBe(422);
    expect(hide.body.detail).toMatch(/can be relabelled but not hidden/);
    const relabel = await call<Managed>(admin, 'PUT', '/value-sets/enrolment-status-code/members/withdrawn/override', { displayLabel: 'Left the university' });
    expect(relabel.body.displayLabel).toBe('Left the university');
  });

  it('does not override the institution\'s own values, or unknown ones', async () => {
    const added = await call(admin, 'POST', '/value-sets/application-withdrawal-reason-code/members', { code: 'moved-abroad', displayLabel: 'Moved abroad' });
    expect(added.status).toBe(201);
    expect((await call(admin, 'PUT', '/value-sets/application-withdrawal-reason-code/members/moved-abroad/override', { hidden: true })).status).toBe(404);
    expect((await call(admin, 'PUT', '/value-sets/mode-of-study-code/members/no-such-code/override', { hidden: true })).status).toBe(404);
  });
});

describe('managing valid values', () => {
  it('lists each set with the fields it governs and whether it can be hidden', async () => {
    const sets = (await call<Array<{ setCode: string; allowsTenantHide: boolean; usedBy: Array<{ entityName: string; fieldName: string }> }>>(registry, 'GET', '/value-sets')).body;
    const mode = sets.find((s) => s.setCode === 'mode-of-study-code')!;
    expect(mode.allowsTenantHide).toBe(true);
    expect(mode.usedBy).toEqual(expect.arrayContaining([{ entityName: 'enrolment', fieldName: 'mode_of_study_code' }, { entityName: 'programme', fieldName: 'mode_of_study_code' }]));
    expect(sets.find((s) => s.setCode === 'enrolment-status-code')?.allowsTenantHide).toBe(false);
  });

  it('lists retired values in the management view and to label old records', async () => {
    await call(admin, 'POST', '/value-sets/application-withdrawal-reason-code/members', { code: 'old-reason', displayLabel: 'Old reason', activeTo: '2020-01-01' });
    const managed = (await call<Managed[]>(admin, 'GET', '/value-sets/application-withdrawal-reason-code/members')).body;
    expect(managed.find((m) => m.code === 'old-reason')).toMatchObject({ active: false, selectable: false, isTenantOwned: true });
    const picker = (await call<{ members: Member[] }>(registry, 'GET', '/fields/student_application/withdrawal_reason_code/value-set')).body.members;
    expect(picker.map((m) => m.code)).not.toContain('old-reason');
    const all = (await call<{ members: Member[] }>(registry, 'GET', '/fields/student_application/withdrawal_reason_code/value-set?include=all')).body.members;
    expect(all.find((m) => m.code === 'old-reason')?.displayLabel).toBe('Old reason');
  });

  it('needs config:write to relabel or hide', async () => {
    expect((await call(registry, 'PUT', '/value-sets/mode-of-study-code/members/full-time/override', { hidden: true })).status).toBe(403);
    expect((await call(registry, 'DELETE', '/value-sets/mode-of-study-code/members/full-time/override')).status).toBe(403);
  });
});
