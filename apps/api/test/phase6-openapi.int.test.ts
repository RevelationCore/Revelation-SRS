import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startTestApp, type TestApp } from './helpers/test-app.js';

let ctx: TestApp;

beforeAll(async () => {
  ctx = await startTestApp();
}, 120_000);

afterAll(async () => {
  await ctx?.teardown();
});

describe('Phase 6 OpenAPI coverage', () => {
  it('renders a valid OpenAPI spec with regulatory and governance resources tagged', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/api/v1/openapi.json' });
    expect(res.statusCode).toBe(200);
    const spec = res.json<{
      openapi: string;
      tags: Array<{ name: string }>;
      paths: Record<string, Record<string, { tags?: string[] }>>;
    }>();
    expect(spec.openapi).toMatch(/^3\./);
    expect(spec.tags.map((tag) => tag.name)).toEqual(expect.arrayContaining(['regulatory', 'governance']));

    const requiredPaths = [
      '/api/v1/regulatory/ucas/applications',
      '/api/v1/regulatory/ucas/confirmations/generate',
      '/api/v1/regulatory/hesa/returns',
      '/api/v1/regulatory/slc/confirmations/generate',
      '/api/v1/regulatory/slc/notifications',
      '/api/v1/regulatory/ukvi/cas-requests/generate',
      '/api/v1/regulatory/ukvi/attendance-reports/generate',
      '/api/v1/regulatory/ukvi/visa-updates',
      '/api/v1/regulatory/ofs/b3-extracts',
      '/api/v1/regulatory/foi/requests',
      '/api/v1/exam-boards/{boardId}/exam-entries/generate',
      '/api/v1/exam-boards/{boardId}/exam-schedule',
      '/api/v1/module-registrations/{moduleRegistrationId}/exam-entry',
      '/api/v1/module-registrations/{moduleRegistrationId}/exam-timetable',
    ];

    for (const path of requiredPaths) {
      expect(spec.paths[path], `missing OpenAPI path ${path}`).toBeDefined();
      const tags = Object.values(spec.paths[path]!).flatMap((operation) => operation.tags ?? []);
      expect(tags.length, `missing tags for ${path}`).toBeGreaterThan(0);
      expect(tags).toContain(path.includes('/regulatory/') ? 'regulatory' : 'governance');
    }
  });
});
