/**
 * Stage 5 — Admissions and Communications Clean Cut integration tests.
 *
 * Exit criteria:
 *   - UCAS is an adapter, not a process owner.
 *   - Student/applicant communications are workflow-triggered, auditable,
 *     and locale-aware.
 *
 * Tests cover:
 *   1. Three new communication channel flags exist with correct defaults
 *   2. Communication trigger rules are active (admissions + enrolment)
 *   3. All 5 admission routes use the same command surface (AdmissionsService)
 *   4. CommunicationService.dispatch respects channel flags:
 *        - channel off → suppressed (audit record written, 200 returned)
 *        - channel on  → dispatched (audit record written, 200 returned)
 *   5. Locale-aware template resolution: preferred → fallback → en-GB
 *   6. Dispatch log is auditable (GET /communication-dispatch-log)
 *   7. Template management (POST/GET /communication-templates)
 *   8. System-level templates seeded in migration are listable
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

import { startTestApp, type TestApp } from './helpers/test-app.js';

let ctx: TestApp;
let jwt: string;       // registry-administrator (communications:read/write, exam-board:write)
let adminJwt: string;  // tenant-administrator  (feature-flag:write, communications:write)

beforeAll(async () => {
  ctx      = await startTestApp();
  jwt      = await ctx.makeJwt();
  adminJwt = await ctx.makeJwt({ roles: ['tenant-administrator'] });
}, 120_000);

afterAll(async () => {
  await ctx?.teardown();
});

// ── Helpers ───────────────────────────────────────────────────────────────────

async function enableFlag(flagKey: string, variantKey: string): Promise<void> {
  const listRes = await ctx.app.inject({
    method:  'GET',
    url:     '/api/v1/feature-flags',
    headers: { authorization: `Bearer ${adminJwt}` },
  });
  const flags = listRes.json<Array<{ flagKey: string; featureFlagId: string }>>();
  const flag = flags.find((f) => f.flagKey === flagKey);
  if (!flag) throw new Error(`Feature flag not found: ${flagKey}`);

  await ctx.db.execute(sql`
    UPDATE feature_flag_assignment
    SET active_to = now() - interval '1 millisecond'
    WHERE flag_id = ${flag.featureFlagId}::uuid
      AND tenant_id = ${ctx.tenantId}::uuid
      AND (active_to IS NULL OR active_to > now())
  `);

  const res = await ctx.app.inject({
    method:  'POST',
    url:     `/api/v1/feature-flags/${flag.featureFlagId}/assignments`,
    headers: { authorization: `Bearer ${adminJwt}` },
    payload: { variantKey, activeFrom: new Date(Date.now() - 1000).toISOString() },
  });
  expect(res.statusCode).toBe(201);
}

async function dispatch(opts: {
  templateKey:       string;
  channelCode:       'email' | 'crm-handoff' | 'integration-event';
  subjectEntityType: string;
  subjectEntityId:   string;
  payload?:          Record<string, unknown>;
  preferredLocale?:  string;
}) {
  return ctx.app.inject({
    method:  'POST',
    url:     '/api/v1/communications/dispatch',
    headers: { authorization: `Bearer ${jwt}` },
    payload: { payload: {}, ...opts },
  });
}

// ── Communication channel flags ───────────────────────────────────────────────

describe('Stage 5 communication channel flags', () => {
  it('communications.channel.email.enabled exists and defaults to off', async () => {
    const res = await ctx.app.inject({
      method:  'GET',
      url:     '/api/v1/feature-flags',
      headers: { authorization: `Bearer ${jwt}` },
    });
    const flags = res.json<Array<{ flagKey: string; defaultVariantKey: string }>>();
    const flag = flags.find((f) => f.flagKey === 'communications.channel.email.enabled');
    expect(flag, 'communications.channel.email.enabled must exist').toBeDefined();
    expect(flag!.defaultVariantKey).toBe('off');
  });

  it('communications.channel.crm-handoff.enabled exists and defaults to off', async () => {
    const res = await ctx.app.inject({
      method:  'GET',
      url:     '/api/v1/feature-flags',
      headers: { authorization: `Bearer ${jwt}` },
    });
    const flags = res.json<Array<{ flagKey: string; defaultVariantKey: string }>>();
    const flag = flags.find((f) => f.flagKey === 'communications.channel.crm-handoff.enabled');
    expect(flag).toBeDefined();
    expect(flag!.defaultVariantKey).toBe('off');
  });

  it('communications.channel.integration-event.enabled exists and defaults to off', async () => {
    const res = await ctx.app.inject({
      method:  'GET',
      url:     '/api/v1/feature-flags',
      headers: { authorization: `Bearer ${jwt}` },
    });
    const flags = res.json<Array<{ flagKey: string; defaultVariantKey: string }>>();
    const flag = flags.find((f) => f.flagKey === 'communications.channel.integration-event.enabled');
    expect(flag).toBeDefined();
    expect(flag!.defaultVariantKey).toBe('off');
  });
});

// ── Communication trigger rules ───────────────────────────────────────────────

describe('Communication workflow trigger rules', () => {
  it('admissions.handoff-started rule is active and targets communication-dispatch', async () => {
    const rows = await ctx.db.execute(sql`
      SELECT trigger_key, event_type, target_workflow_code, active
      FROM workflow_trigger_rule
      WHERE trigger_key = 'admissions.handoff-started.application-received-comms'
    `);
    const rule = (rows as unknown as Array<{
      trigger_key: string;
      event_type: string;
      target_workflow_code: string;
      active: boolean;
    }>)[0];
    expect(rule, 'admissions handoff communication trigger rule must exist').toBeDefined();
    expect(rule!.active).toBe(true);
    expect(rule!.target_workflow_code).toBe('communication-dispatch');
  });

  it('enrolment.created.welcome-comms rule is active', async () => {
    const rows = await ctx.db.execute(sql`
      SELECT trigger_key, active
      FROM workflow_trigger_rule
      WHERE trigger_key = 'enrolment.created.welcome-comms'
    `);
    const rule = (rows as unknown as Array<{ trigger_key: string; active: boolean }>)[0];
    expect(rule).toBeDefined();
    expect(rule!.active).toBe(true);
  });

  it('old stage-2 placeholder (enrolment-created-future-communication) is now inactive', async () => {
    const rows = await ctx.db.execute(sql`
      SELECT active FROM workflow_trigger_rule
      WHERE trigger_key = 'enrolment-created-future-communication'
    `);
    const rule = (rows as unknown as Array<{ active: boolean }>)[0];
    // Rule may not exist in all environments; if it does exist it must be inactive
    if (rule) {
      expect(rule.active).toBe(false);
    }
  });
});

// ── Admissions: unified source-neutral command surface ────────────────────────

describe('AdmissionsService — unified source-neutral command surface', () => {
  for (const source of [
    'admissions-ucas-domestic',
    'admissions-direct-domestic',
    'admissions-international-direct',
    'admissions-international-agent',
    'admissions-clearing',
  ] as const) {
    it(`workflow definition ${source} is active with a handoff-to-srs-enrolment step`, async () => {
      const steps = await ctx.db.execute(sql`
        SELECT ws.step_key, ws.step_type_code
        FROM workflow_step ws
        JOIN workflow_definition_version wdv ON wdv.id = ws.workflow_definition_version_id
        JOIN workflow_definition wd ON wd.id = wdv.workflow_definition_id
        WHERE wd.definition_code = ${source}
          AND wd.tenant_id IS NULL
          AND wdv.status_code = 'active'
        ORDER BY ws.sort_order
      `);
      const stepList = steps as unknown as Array<{ step_key: string; step_type_code: string }>;
      expect(stepList.length, `${source} must have steps`).toBeGreaterThan(0);
      const handoff = stepList.find((s) => s.step_key === 'handoff-to-srs-enrolment');
      expect(handoff, `${source} must have handoff-to-srs-enrolment step`).toBeDefined();
    });
  }
});

// ── System templates ──────────────────────────────────────────────────────────

describe('Seeded system communication templates', () => {
  it('lists system templates including the seeded en-GB defaults', async () => {
    const res = await ctx.app.inject({
      method:  'GET',
      url:     '/api/v1/communication-templates',
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(res.statusCode).toBe(200);
    const templates = res.json<Array<{ templateKey: string; channelCode: string; localeCode: string }>>();
    const appReceived = templates.find(
      (t) => t.templateKey === 'admissions.application-received' && t.channelCode === 'integration-event',
    );
    expect(appReceived, 'admissions.application-received/integration-event template must exist').toBeDefined();
    expect(appReceived!.localeCode).toBe('en-GB');

    const welcome = templates.find(
      (t) => t.templateKey === 'enrolment.welcome' && t.channelCode === 'integration-event',
    );
    expect(welcome, 'enrolment.welcome/integration-event template must exist').toBeDefined();
  });
});

// ── Communication dispatch — channel flag gates ───────────────────────────────

describe('CommunicationService dispatch — channel flag gates', () => {
  const entityId = '00000000-0000-0000-0000-000000000099';

  it('when integration-event flag is off (default), dispatch is suppressed and audit record written', async () => {
    const res = await dispatch({
      templateKey:       'admissions.application-received',
      channelCode:       'integration-event',
      subjectEntityType: 'ucas_application',
      subjectEntityId:   entityId,
      payload:           { sourceApplicationReference: 'UCAS123' },
    });
    expect(res.statusCode).toBe(200);
    const result = res.json<{ statusCode: string; suppressionReason: string }>();
    expect(result.statusCode).toBe('suppressed');
    expect(result.suppressionReason).toContain('communications.channel.integration-event.enabled');

    // Audit record must exist
    const logRes = await ctx.app.inject({
      method:  'GET',
      url:     `/api/v1/communication-dispatch-log?subjectEntityType=ucas_application&subjectEntityId=${entityId}`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    const entries = logRes.json<Array<{ statusCode: string }>>();
    expect(entries.some((e) => e.statusCode === 'suppressed')).toBe(true);
  });

  it('when integration-event flag is on, dispatch succeeds and audit record shows dispatched', async () => {
    await enableFlag('communications.channel.integration-event.enabled', 'on');

    const entityId2 = '00000000-0000-0000-0000-000000000098';
    const res = await dispatch({
      templateKey:       'enrolment.welcome',
      channelCode:       'integration-event',
      subjectEntityType: 'enrolment',
      subjectEntityId:   entityId2,
      payload:           { academicYear: '2026-27', institutionName: 'Test University' },
    });
    expect(res.statusCode).toBe(200);
    const result = res.json<{ statusCode: string; localeCode: string }>();
    expect(result.statusCode).toBe('dispatched');
    expect(result.localeCode).toBe('en-GB');

    // Audit record must exist
    const logRes = await ctx.app.inject({
      method:  'GET',
      url:     `/api/v1/communication-dispatch-log?subjectEntityType=enrolment&subjectEntityId=${entityId2}`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    const entries = logRes.json<Array<{ statusCode: string }>>();
    expect(entries.some((e) => e.statusCode === 'dispatched')).toBe(true);

    await enableFlag('communications.channel.integration-event.enabled', 'off');
  });

  it('email channel off (default) — email dispatch suppressed', async () => {
    const res = await dispatch({
      templateKey:       'enrolment.welcome',
      channelCode:       'email',
      subjectEntityType: 'enrolment',
      subjectEntityId:   entityId,
    });
    expect(res.statusCode).toBe(200);
    const result = res.json<{ statusCode: string }>();
    expect(result.statusCode).toBe('suppressed');
  });

  it('email channel on — email dispatch succeeds with en-GB template', async () => {
    await enableFlag('communications.channel.email.enabled', 'on');

    const res = await dispatch({
      templateKey:       'enrolment.welcome',
      channelCode:       'email',
      subjectEntityType: 'enrolment',
      subjectEntityId:   '00000000-0000-0000-0000-000000000097',
      payload:           { studentName: 'Jane Smith', institutionName: 'Test University', academicYear: '2026-27' },
    });
    expect(res.statusCode).toBe(200);
    const result = res.json<{ statusCode: string; localeCode: string }>();
    expect(result.statusCode).toBe('dispatched');
    expect(result.localeCode).toBe('en-GB');

    await enableFlag('communications.channel.email.enabled', 'off');
  });
});

// ── Locale-aware template resolution ─────────────────────────────────────────

describe('Locale-aware template resolution', () => {
  it('falls back to en-GB when preferred locale has no template', async () => {
    await enableFlag('communications.channel.integration-event.enabled', 'on');

    const res = await dispatch({
      templateKey:       'enrolment.welcome',
      channelCode:       'integration-event',
      subjectEntityType: 'enrolment',
      subjectEntityId:   '00000000-0000-0000-0000-000000000096',
      preferredLocale:   'cy-GB',  // Welsh — no template seeded
    });
    expect(res.statusCode).toBe(200);
    const result = res.json<{ statusCode: string; localeCode: string }>();
    expect(result.statusCode).toBe('dispatched');
    expect(result.localeCode).toBe('en-GB');  // fell back to en-GB

    await enableFlag('communications.channel.integration-event.enabled', 'off');
  });

  it('uses tenant-specific template override when one exists for the locale', async () => {
    await enableFlag('communications.channel.integration-event.enabled', 'on');

    // Register a tenant-specific override for cy-GB (Welsh)
    const createRes = await ctx.app.inject({
      method:  'POST',
      url:     '/api/v1/communication-templates',
      headers: { authorization: `Bearer ${jwt}` },
      payload: {
        templateKey:   'enrolment.welcome',
        channelCode:   'integration-event',
        localeCode:    'cy-GB',
        bodyTemplate:  '{"eventType": "enrolment.welcome", "message": "Croeso i {institutionName}!", "locale": "cy-GB"}',
      },
    });
    expect(createRes.statusCode).toBe(201);

    const res = await dispatch({
      templateKey:       'enrolment.welcome',
      channelCode:       'integration-event',
      subjectEntityType: 'enrolment',
      subjectEntityId:   '00000000-0000-0000-0000-000000000095',
      preferredLocale:   'cy-GB',
    });
    expect(res.statusCode).toBe(200);
    const result = res.json<{ statusCode: string; localeCode: string }>();
    expect(result.statusCode).toBe('dispatched');
    expect(result.localeCode).toBe('cy-GB');  // tenant override was used

    await enableFlag('communications.channel.integration-event.enabled', 'off');
  });
});

// ── Template management ───────────────────────────────────────────────────────

describe('Template management', () => {
  it('creates a tenant-scoped template and retrieves it by ID', async () => {
    const createRes = await ctx.app.inject({
      method:  'POST',
      url:     '/api/v1/communication-templates',
      headers: { authorization: `Bearer ${jwt}` },
      payload: {
        templateKey:      'assessment.mark-released',
        channelCode:      'email',
        localeCode:       'en-GB',
        subjectTemplate:  'Your mark for {moduleCode} has been released',
        bodyTemplate:     'Dear {studentName}, your mark for {moduleCode} is now available.',
      },
    });
    expect(createRes.statusCode).toBe(201);
    const created = createRes.json<{ templateId: string; templateKey: string; tenantId: string }>();
    expect(created.templateKey).toBe('assessment.mark-released');
    expect(created.tenantId).toBe(ctx.tenantId);

    const getRes = await ctx.app.inject({
      method:  'GET',
      url:     `/api/v1/communication-templates/${created.templateId}`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(getRes.statusCode).toBe(200);
    expect(getRes.json<{ templateKey: string }>().templateKey).toBe('assessment.mark-released');
  });

  it('requires communications:read to list templates', async () => {
    const res = await ctx.app.inject({
      method:  'GET',
      url:     '/api/v1/communication-templates',
      headers: { authorization: `Bearer ${await ctx.makeJwt({ roles: ['student'] })}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it('requires communications:write to create a template', async () => {
    const res = await ctx.app.inject({
      method:  'POST',
      url:     '/api/v1/communication-templates',
      headers: { authorization: `Bearer ${await ctx.makeJwt({ roles: ['student'] })}` },
      payload: {
        templateKey:  'test.template',
        channelCode:  'email',
        bodyTemplate: 'Test',
      },
    });
    expect(res.statusCode).toBe(403);
  });

  it('returns 404 for a non-existent template', async () => {
    const res = await ctx.app.inject({
      method:  'GET',
      url:     '/api/v1/communication-templates/00000000-0000-0000-0000-000000000000',
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(res.statusCode).toBe(404);
  });
});

// ── Dispatch log — auditability ───────────────────────────────────────────────

describe('Dispatch log — auditability', () => {
  it('returns paginated dispatch log entries for the tenant', async () => {
    const res = await ctx.app.inject({
      method:  'GET',
      url:     '/api/v1/communication-dispatch-log',
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(res.statusCode).toBe(200);
    const entries = res.json<Array<{ tenantId: string; statusCode: string }>>();
    expect(Array.isArray(entries)).toBe(true);
    // All entries should belong to our tenant
    for (const entry of entries) {
      expect(entry.tenantId).toBe(ctx.tenantId);
    }
  });

  it('requires communications:read to view the dispatch log', async () => {
    const res = await ctx.app.inject({
      method:  'GET',
      url:     '/api/v1/communication-dispatch-log',
      headers: { authorization: `Bearer ${await ctx.makeJwt({ roles: ['student'] })}` },
    });
    expect(res.statusCode).toBe(403);
  });
});
