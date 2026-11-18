import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startTestApp, type TestApp } from './helpers/test-app.js';

/**
 * One wording table for relabels and translations. A value's wording is the
 * most specific match: this institution in the reader's language, this
 * institution in any language, the platform in the reader's language, then
 * the value's own label. The code never changes. Hiding is separate: a
 * hidden value leaves pickers but still labels records and validates.
 */

interface Member { code: string; displayLabel: string; description: string | null; active: boolean; hidden: boolean; selectable: boolean }
interface Wording { scope: 'tenant' | 'platform'; localeCode: string | null; displayLabel: string | null; description: string | null }
interface Managed extends Member { isTenantOwned: boolean; platformLabel: string; overridden: boolean; wordings: Wording[] }

let ctx: TestApp;
let admin: string;
let otherAdmin: string;
let registry: string;
let sysadmin: string;

async function call<T>(jwt: string, method: 'GET' | 'PUT' | 'DELETE' | 'POST', url: string, payload?: unknown) {
  const res = await ctx.app.inject({ method, url: `/api/v1${url}`, headers: { authorization: `Bearer ${jwt}` }, ...(payload !== undefined ? { payload: payload as object } : {}) });
  return { status: res.statusCode, body: (res.body ? res.json() : undefined) as T };
}

const label = async (jwt: string, code: string, locale?: string) =>
  (await call<{ members: Member[] }>(jwt, 'GET', `/fields/enrolment/mode_of_study_code/value-set?include=all${locale ? `&locale=${locale}` : ''}`))
    .body.members.find((m) => m.code === code)?.displayLabel;

const wording = (jwt: string, code: string, body: Record<string, unknown>) =>
  call<Managed>(jwt, 'PUT', `/value-sets/mode-of-study-code/members/${code}/wording`, body);

beforeAll(async () => {
  ctx = await startTestApp();
  admin = await ctx.makeJwt({ roles: ['tenant-administrator'] });
  otherAdmin = await ctx.makeJwt({ roles: ['tenant-administrator'], tenantId: ctx.secondTenantId });
  registry = await ctx.makeJwt();
  sysadmin = await ctx.makeJwt({ roles: ['system-administrator'] });
}, 120_000);

afterAll(async () => {
  await ctx?.teardown();
});

describe('wording', () => {
  it('relabels a value for this institution only, keeping the code and the platform label', async () => {
    const res = await wording(admin, 'part-time', { displayLabel: 'Part-time (evening)', description: 'Taught in the evenings' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      code: 'part-time', displayLabel: 'Part-time (evening)', description: 'Taught in the evenings', platformLabel: 'Part-time', overridden: true,
    });
    expect(res.body.wordings).toEqual([expect.objectContaining({ scope: 'tenant', localeCode: null, displayLabel: 'Part-time (evening)' })]);
    expect(await label(registry, 'part-time')).toBe('Part-time (evening)');
    expect(await label(otherAdmin, 'part-time')).toBe('Part-time');
  });

  it('shows the most specific wording for the reader\'s language', async () => {
    // The platform's Welsh, written by a platform translator.
    expect((await wording(sysadmin, 'full-time', { scope: 'platform', localeCode: 'cy-GB', displayLabel: 'Amser llawn' })).status).toBe(200);
    expect(await label(otherAdmin, 'full-time', 'cy-GB')).toBe('Amser llawn');
    expect(await label(otherAdmin, 'full-time')).toBe('Full-time');

    // This institution's own wording (any language) beats the platform's Welsh...
    await wording(admin, 'full-time', { displayLabel: 'Full-time study' });
    expect(await label(registry, 'full-time', 'cy-GB')).toBe('Full-time study');
    // ...and its own Welsh beats both.
    await wording(admin, 'full-time', { localeCode: 'cy-GB', displayLabel: 'Astudio amser llawn' });
    expect(await label(registry, 'full-time', 'cy-GB')).toBe('Astudio amser llawn');
    expect(await label(registry, 'full-time')).toBe('Full-time study');
    // Another institution still sees the platform's Welsh.
    expect(await label(otherAdmin, 'full-time', 'cy-GB')).toBe('Amser llawn');
  });

  it('removes one wording when it is cleared, and restores every wording at once', async () => {
    await wording(admin, 'full-time', { localeCode: 'cy-GB', displayLabel: null });
    expect(await label(registry, 'full-time', 'cy-GB')).toBe('Full-time study');

    const restored = await call<Managed>(admin, 'DELETE', '/value-sets/mode-of-study-code/members/full-time/customisation');
    expect(restored.body).toMatchObject({ displayLabel: 'Full-time', overridden: false });
    expect(restored.body.wordings.map((w) => w.scope)).toEqual(['platform']);
    expect(await label(registry, 'full-time', 'cy-GB')).toBe('Amser llawn');
  });

  it('keeps platform wording to platform translators, and to a language', async () => {
    expect((await wording(admin, 'distance', { scope: 'platform', localeCode: 'cy-GB', displayLabel: 'Pell' })).status).toBe(403);
    expect((await wording(sysadmin, 'distance', { scope: 'platform', displayLabel: 'Distance' })).status).toBe(422);
    expect((await wording(admin, 'distance', { localeCode: 'xx-XX', displayLabel: 'x' })).status).toBe(422);
    expect((await wording(registry, 'distance', { displayLabel: 'x' })).status).toBe(403);
  });

  it('translates an institution\'s own value; its any-language wording is edited on the value itself', async () => {
    expect((await call(admin, 'POST', '/value-sets/application-withdrawal-reason-code/members', { code: 'moved-abroad', displayLabel: 'Moved abroad' })).status).toBe(201);
    const url = '/value-sets/application-withdrawal-reason-code/members/moved-abroad/wording';
    expect((await call(admin, 'PUT', url, { displayLabel: 'Abroad' })).status).toBe(422);
    expect((await call(admin, 'PUT', url, { localeCode: 'cy-GB', displayLabel: 'Symud dramor' })).status).toBe(200);
    const welsh = (await call<{ members: Member[] }>(registry, 'GET', '/fields/student_application/withdrawal_reason_code/value-set?locale=cy-GB')).body.members;
    expect(welsh.find((m) => m.code === 'moved-abroad')?.displayLabel).toBe('Symud dramor');
  });
});

describe('hiding', () => {
  it('leaves pickers but still labels and validates', async () => {
    const res = await call<Managed>(admin, 'PUT', '/value-sets/mode-of-study-code/members/sandwich/hidden', { hidden: true });
    expect(res.body).toMatchObject({ code: 'sandwich', hidden: true, selectable: false, overridden: true });

    const picker = (await call<{ members: Member[] }>(registry, 'GET', '/fields/enrolment/mode_of_study_code/value-set')).body.members.map((m) => m.code);
    expect(picker).not.toContain('sandwich');
    expect(await label(registry, 'sandwich')).toBeTruthy();
    expect(await ctx.app.valueSetService.validateFieldValue('enrolment', 'mode_of_study_code', 'sandwich', ctx.tenantId)).toBe(true);
    expect((await call<{ members: Member[] }>(otherAdmin, 'GET', '/fields/enrolment/mode_of_study_code/value-set')).body.members.map((m) => m.code)).toContain('sandwich');

    await call(admin, 'PUT', '/value-sets/mode-of-study-code/members/sandwich/hidden', { hidden: false });
    expect((await call<{ members: Member[] }>(registry, 'GET', '/fields/enrolment/mode_of_study_code/value-set')).body.members.map((m) => m.code)).toContain('sandwich');
  });

  it('refuses to hide a lifecycle status the system writes, but allows relabelling it', async () => {
    const hide = await call<{ detail: string }>(admin, 'PUT', '/value-sets/enrolment-status-code/members/withdrawn/hidden', { hidden: true });
    expect(hide.status).toBe(422);
    expect(hide.body.detail).toMatch(/can be relabelled but not hidden/);
    const relabel = await call<Managed>(admin, 'PUT', '/value-sets/enrolment-status-code/members/withdrawn/wording', { displayLabel: 'Left the university' });
    expect(relabel.body.displayLabel).toBe('Left the university');
  });

  it('does not hide an institution\'s own value or an unknown one', async () => {
    expect((await call(admin, 'PUT', '/value-sets/application-withdrawal-reason-code/members/moved-abroad/hidden', { hidden: true })).status).toBe(422);
    expect((await call(admin, 'PUT', '/value-sets/mode-of-study-code/members/no-such-code/hidden', { hidden: true })).status).toBe(404);
  });
});

describe('managing valid values', () => {
  it('lists each set with the fields it governs and whether it can be hidden', async () => {
    const sets = (await call<Array<{ setCode: string; allowsTenantHide: boolean; usedBy: Array<{ entityName: string; fieldName: string }> }>>(registry, 'GET', '/value-sets')).body;
    const mode = sets.find((s) => s.setCode === 'mode-of-study-code')!;
    expect(mode.allowsTenantHide).toBe(true);
    expect(mode.usedBy).toEqual(expect.arrayContaining([{ entityName: 'enrolment', fieldName: 'mode_of_study_code' }]));
    expect(sets.find((s) => s.setCode === 'enrolment-status-code')?.allowsTenantHide).toBe(false);
  });

  it('carries the portal\'s Welsh labels into the value sets', async () => {
    const welsh = (await call<{ members: Member[] }>(registry, 'GET', '/fields/enrolment/status_code/value-set?locale=cy-GB&include=all')).body.members;
    expect(welsh.find((m) => m.code === 'enrolled')?.displayLabel).toBe('Wedi cofrestru');
  });

  it('lists retired values in the management view and to label old records', async () => {
    await call(admin, 'POST', '/value-sets/application-withdrawal-reason-code/members', { code: 'old-reason', displayLabel: 'Old reason', activeTo: '2020-01-01' });
    const managed = (await call<Managed[]>(admin, 'GET', '/value-sets/application-withdrawal-reason-code/members')).body;
    expect(managed.find((m) => m.code === 'old-reason')).toMatchObject({ active: false, selectable: false, isTenantOwned: true });
    const all = (await call<{ members: Member[] }>(registry, 'GET', '/fields/student_application/withdrawal_reason_code/value-set?include=all')).body.members;
    expect(all.find((m) => m.code === 'old-reason')?.displayLabel).toBe('Old reason');
  });

  it('never shows one institution another\'s wording', async () => {
    await wording(otherAdmin, 'part-time', { displayLabel: 'Theirs' });
    const mine = (await call<Managed[]>(admin, 'GET', '/value-sets/mode-of-study-code/members')).body.find((m) => m.code === 'part-time')!;
    expect(mine.wordings.map((w) => w.displayLabel)).not.toContain('Theirs');
    expect(await label(registry, 'part-time')).toBe('Part-time (evening)');
  });
});
