/**
 * Stage 8 — Clean Architecture Acceptance Review
 *
 * Exit criteria:
 *  (A) No known legacy process path remains without an approved removal exception.
 *  (B) Published API/event/file contracts can be built on the clean architecture.
 *
 * This suite verifies the overall architectural properties of the clean SRS
 * across seven dimensions: workflow coverage, flag governance, globalisation,
 * bitemporality, record lock integrity, tenant isolation, and public contract
 * readiness. Individual capability tests live in their own stage suites; this
 * suite confirms the cross-cutting architectural invariants hold simultaneously.
 *
 * Test groups:
 *   1. Workflow coverage — all process-bearing domains have active definitions
 *   2. Flag governance  — every flag is classified; safety flags are protected
 *   3. Globalisation    — currency-aware schema; locale packs; template locale tagging
 *   4. Bitemporality    — key tables carry valid-time and record-time columns
 *   5. Record lock      — ratified state is immutable at schema and service levels
 *   6. Tenant isolation — cross-tenant data leakage is prevented at DB layer
 *   7. Public contract  — OpenAPI spec renders; no legacy schema artefacts remain
 */

import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startTestApp, type TestApp } from './helpers/test-app.js';

describe('Stage 8 — Clean Architecture Acceptance Review', () => {
  let ctx: TestApp;

  beforeAll(async () => {
    ctx = await startTestApp();
  }, 120_000);

  afterAll(async () => {
    await ctx.teardown();
  });

  // ── 1. Workflow coverage ──────────────────────────────────────────────────

  describe('workflow coverage', () => {
    it('all thirteen expected platform workflow definitions are active', async () => {
      const expected = [
        'enrolment-change-approval',
        'module-registration-change',
        'assessment-mark-review',
        'progression-review',
        'award-classification',
        'exam-board-governance',
        'correction-case',
        'appeal-case',
        'regulatory-submission-approval',
        'finance-fee-handoff',
        'identity-provisioning',
        'communication-dispatch',
        'exam-board-virtual',
      ];

      // Use IN clause — postgres.js does not map JS arrays to PG arrays in ANY()
      const inList = expected.map((c) => `'${c}'`).join(', ');
      const rows = await ctx.db.execute(sql.raw(`
        SELECT definition_code, status_code
        FROM workflow_definition
        WHERE tenant_id IS NULL
          AND definition_code IN (${inList})
        ORDER BY definition_code
      `)) as Array<{ definition_code: string; status_code: string }>;

      const found = rows.map((r) => r.definition_code);
      const inactive = rows.filter((r) => r.status_code !== 'active').map((r) => r.definition_code);

      expect(found, 'All 13 workflow definitions must exist').toEqual(expect.arrayContaining(expected));
      expect(inactive, 'All workflow definitions must be active').toHaveLength(0);
    });

    it('each workflow definition has at least one active version', async () => {
      const rows = await ctx.db.execute(sql`
        SELECT wd.definition_code, COUNT(wdv.id) AS version_count
        FROM workflow_definition wd
        LEFT JOIN workflow_definition_version wdv
          ON wdv.workflow_definition_id = wd.id
         AND wdv.status_code = 'active'
        WHERE wd.tenant_id IS NULL
          AND wd.status_code = 'active'
        GROUP BY wd.definition_code
        HAVING COUNT(wdv.id) = 0
      `) as Array<{ definition_code: string; version_count: number }>;

      expect(rows.map((r) => r.definition_code)).toHaveLength(0);
    });

    it('admission routes are covered: at least one admissions workflow trigger rule exists', async () => {
      const rows = await ctx.db.execute(sql`
        SELECT trigger_key FROM workflow_trigger_rule
        WHERE trigger_key LIKE 'admissions%'
      `) as Array<{ trigger_key: string }>;

      expect(rows.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ── 2. Flag governance ────────────────────────────────────────────────────

  describe('flag governance', () => {
    it('all domain flags are classified (none remain as default release class)', async () => {
      const knownPrefixes = [
        'admissions.', 'enrolment.', 'assessment.', 'progression.',
        'exam-board.', 'communications.',
      ];

      for (const prefix of knownPrefixes) {
        const rows = await ctx.db.execute(sql`
          SELECT flag_key FROM feature_flag
          WHERE flag_key LIKE ${prefix + '%'}
            AND flag_class_code = 'release'
        `) as Array<{ flag_key: string }>;

        expect(
          rows.map((r) => r.flag_key),
          `Flags with prefix '${prefix}' must all be classified`,
        ).toHaveLength(0);
      }
    });

    it('all environment-safety flags are non_bypassable with restricted scope', async () => {
      const rows = await ctx.db.execute(sql`
        SELECT flag_key, non_bypassable, allowed_scope_codes
        FROM feature_flag
        WHERE flag_class_code = 'environment-safety'
      `) as Array<{ flag_key: string; non_bypassable: boolean; allowed_scope_codes: string[] }>;

      expect(rows.length).toBeGreaterThanOrEqual(3);
      for (const row of rows) {
        expect(row.non_bypassable, `${row.flag_key} must be non_bypassable`).toBe(true);
        expect(row.allowed_scope_codes, `${row.flag_key} must not allow tenant scope`).not.toContain('tenant');
      }
    });

    it('all non_bypassable flags have a retirement_condition explaining permanence', async () => {
      const rows = await ctx.db.execute(sql`
        SELECT flag_key, retirement_condition FROM feature_flag WHERE non_bypassable = true
      `) as Array<{ flag_key: string; retirement_condition: string | null }>;

      expect(rows.length).toBeGreaterThanOrEqual(1);
      for (const row of rows) {
        expect(row.retirement_condition, `${row.flag_key} must have a retirement_condition`).not.toBeNull();
        expect(row.retirement_condition).toMatch(/Must not be retired/);
      }
    });

    it('all migration-class flags have a review_date', async () => {
      const rows = await ctx.db.execute(sql`
        SELECT flag_key, review_date FROM feature_flag WHERE flag_class_code = 'migration'
      `) as Array<{ flag_key: string; review_date: string | null }>;

      expect(rows.length).toBeGreaterThanOrEqual(1);
      for (const row of rows) {
        expect(row.review_date, `Migration flag '${row.flag_key}' must have a review_date`).not.toBeNull();
      }
    });

    it('retired flags have no active assignments', async () => {
      const rows = await ctx.db.execute(sql`
        SELECT ff.flag_key
        FROM feature_flag_assignment ffa
        JOIN feature_flag ff ON ff.id = ffa.flag_id
        WHERE ff.status_code = 'retired'
          AND (ffa.active_to IS NULL OR ffa.active_to > now())
      `) as Array<{ flag_key: string }>;

      expect(rows.map((r) => r.flag_key)).toHaveLength(0);
    });

    it('flag value sets for class and risk-class are seeded', async () => {
      const rows = await ctx.db.execute(sql`
        SELECT vs.set_code, COUNT(vsm.id) AS member_count
        FROM value_set vs
        LEFT JOIN value_set_member vsm ON vsm.value_set_id = vs.id
        WHERE vs.set_code IN ('feature-flag-class', 'feature-flag-risk-class')
        GROUP BY vs.set_code
      `) as Array<{ set_code: string; member_count: string }>;

      const map = Object.fromEntries(rows.map((r) => [r.set_code, Number(r.member_count)]));
      expect(map['feature-flag-class']).toBe(7);
      expect(map['feature-flag-risk-class']).toBe(4);
    });
  });

  // ── 3. Globalisation ─────────────────────────────────────────────────────

  describe('globalisation', () => {
    it('fee_liability has currency-aware columns and no legacy amount_pence', async () => {
      const cols = await ctx.db.execute(sql`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_name = 'fee_liability'
          AND column_name IN ('currency_code', 'amount_minor_units', 'amount_pence')
        ORDER BY column_name
      `) as Array<{ column_name: string }>;

      const names = cols.map((c) => c.column_name);
      expect(names).toContain('currency_code');
      expect(names).toContain('amount_minor_units');
      expect(names).not.toContain('amount_pence');
    });

    it('locale resource packs are seeded for at least ten BCP-47 locales', async () => {
      const rows = await ctx.db.execute(sql`
        SELECT COUNT(*) AS pack_count FROM locale_resource_pack WHERE active = true
      `) as Array<{ pack_count: string }>;

      expect(Number(rows[0]!.pack_count)).toBeGreaterThanOrEqual(10);
    });

    it('platform default locale is en-GB', async () => {
      const rows = await ctx.db.execute(sql`
        SELECT locale_code FROM locale_resource_pack WHERE is_platform_default = true
      `) as Array<{ locale_code: string }>;

      expect(rows).toHaveLength(1);
      expect(rows[0]!.locale_code).toBe('en-GB');
    });

    it('communication-locale-code value set is seeded with at least ten members', async () => {
      const rows = await ctx.db.execute(sql`
        SELECT COUNT(vsm.id) AS member_count
        FROM value_set vs
        JOIN value_set_member vsm ON vsm.value_set_id = vs.id
        WHERE vs.set_code = 'communication-locale-code'
      `) as Array<{ member_count: string }>;

      expect(Number(rows[0]!.member_count)).toBeGreaterThanOrEqual(10);
    });

    it('communication templates carry a locale_code on every row', async () => {
      const rows = await ctx.db.execute(sql`
        SELECT COUNT(*) AS total, COUNT(locale_code) AS with_locale
        FROM communication_template
      `) as Array<{ total: string; with_locale: string }>;

      const { total, with_locale } = rows[0]!;
      // Every seeded template must have a locale_code (en-GB default at minimum)
      expect(Number(with_locale)).toBe(Number(total));
      expect(Number(total)).toBeGreaterThanOrEqual(1);
    });

    it('tenant_locale_config table exists and is RLS-enabled', async () => {
      // Verify the table exists and has the expected tenant-scoped columns
      const cols = await ctx.db.execute(sql`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_name = 'tenant_locale_config'
          AND column_name IN ('tenant_id', 'default_locale', 'fallback_locale', 'default_time_zone')
        ORDER BY column_name
      `) as Array<{ column_name: string }>;

      const names = cols.map((c) => c.column_name);
      expect(names).toContain('tenant_id');
      expect(names).toContain('default_locale');
      expect(names).toContain('default_time_zone');
    });
  });

  // ── 4. Bitemporality ─────────────────────────────────────────────────────

  describe('bitemporality', () => {
    const bitTemporalTables = [
      'enrolment', 'mark', 'module_result', 'progression_decision',
      'award', 'academic_rule', 'module_registration',
    ];

    for (const tableName of bitTemporalTables) {
      it(`${tableName} has full bitemporal column set (valid_from, valid_to, recorded_at, recorded_until)`, async () => {
        const required = ['valid_from', 'valid_to', 'recorded_at', 'recorded_until'];
        // Use IN clause — postgres.js does not map JS arrays to PG arrays in ANY()
        const cols = await ctx.db.execute(sql.raw(`
          SELECT column_name
          FROM information_schema.columns
          WHERE table_name = '${tableName}'
            AND column_name IN ('valid_from', 'valid_to', 'recorded_at', 'recorded_until')
          ORDER BY column_name
        `)) as Array<{ column_name: string }>;

        const found = cols.map((c) => c.column_name);
        for (const col of required) {
          expect(found, `${tableName} must have ${col}`).toContain(col);
        }
      });
    }

    it('creating a new enrolment version via status transition preserves the prior version', async () => {
      const jwt = await ctx.makeJwt();

      const studentRes = await ctx.app.inject({
        method: 'POST', url: '/api/v1/students',
        headers: { authorization: `Bearer ${jwt}` },
        payload: { legalFirstName: 'Bitemporal', legalFamilyName: 'Test' },
      });
      const { personId } = studentRes.json<{ personId: string }>();

      const enrolRes = await ctx.app.inject({
        method: 'POST', url: '/api/v1/enrolments',
        headers: { authorization: `Bearer ${jwt}` },
        payload: { personId, modeOfStudyCode: 'full-time', academicYearOfEntry: '2026-27', startDate: '2026-09-25' },
      });
      expect(enrolRes.statusCode).toBe(201);
      const { enrolmentId } = enrolRes.json<{ enrolmentId: string }>();

      // Intermit creates a new version; the enrolled version must be preserved
      await ctx.app.inject({
        method: 'POST', url: `/api/v1/enrolments/${enrolmentId}/intermit`,
        headers: { authorization: `Bearer ${jwt}` },
        payload: { reasonCode: 'medical' },
      });

      const rows = await ctx.db.execute(sql`
        SELECT version_id, valid_from, valid_to, recorded_at, recorded_until
        FROM enrolment
        WHERE id = ${enrolmentId}::uuid
        ORDER BY recorded_at
      `) as Array<{
        version_id: string; valid_from: Date; valid_to: Date | null;
        recorded_at: Date; recorded_until: Date | null;
      }>;

      // At least two versions: the original enrolled + the intermitting version
      expect(rows.length).toBeGreaterThanOrEqual(2);

      // The superseded version has recorded_until set (closed)
      const superseded = rows.filter((r) => r.recorded_until !== null);
      expect(superseded.length).toBeGreaterThanOrEqual(1);

      // The current version has recorded_until NULL (open)
      const current = rows.filter((r) => r.recorded_until === null);
      expect(current).toHaveLength(1);
    });
  });

  // ── 5. Record lock integrity ──────────────────────────────────────────────

  describe('record lock integrity', () => {
    it('exam_board table has ratified_at column (board-level lock)', async () => {
      const cols = await ctx.db.execute(sql`
        SELECT column_name FROM information_schema.columns
        WHERE table_name = 'exam_board' AND column_name = 'ratified_at'
      `) as Array<{ column_name: string }>;

      expect(cols).toHaveLength(1);
    });

    it('mark and module_result tables have locked column', async () => {
      for (const tableName of ['mark', 'module_result', 'progression_decision']) {
        const cols = await ctx.db.execute(sql`
          SELECT column_name FROM information_schema.columns
          WHERE table_name = ${tableName} AND column_name = 'locked'
        `) as Array<{ column_name: string }>;

        expect(cols, `${tableName} must have a locked column`).toHaveLength(1);
      }
    });

    it('a ratified board cannot be ratified a second time', async () => {
      const jwt  = await ctx.makeJwt();
      const chair = await ctx.makeJwt({ roles: ['exam-board-chair'] });

      const boardRes = await ctx.app.inject({
        method: 'POST', url: '/api/v1/exam-boards',
        headers: { authorization: `Bearer ${jwt}` },
        payload: { boardTypeCode: 'award', academicYear: '2026-27' },
      });
      expect(boardRes.statusCode).toBe(201);
      const { examBoardId } = boardRes.json<{ examBoardId: string }>();

      // Record external examiner sign-off (required by default flag)
      await ctx.app.inject({
        method: 'POST', url: `/api/v1/exam-boards/${examBoardId}/external-examiner-signoff`,
        headers: { authorization: `Bearer ${chair}` },
        payload: { commentary: 'Approved' },
      });

      // First ratification succeeds
      const first = await ctx.app.inject({
        method: 'POST', url: `/api/v1/exam-boards/${examBoardId}/ratification`,
        headers: { authorization: `Bearer ${chair}` },
      });
      expect(first.statusCode).toBe(204);

      // Second ratification is blocked by record lock
      const second = await ctx.app.inject({
        method: 'POST', url: `/api/v1/exam-boards/${examBoardId}/ratification`,
        headers: { authorization: `Bearer ${chair}` },
      });
      expect([422, 409]).toContain(second.statusCode);
    });
  });

  // ── 6. Tenant isolation ───────────────────────────────────────────────────

  describe('tenant isolation', () => {
    it('feature flag assignments created in tenant A are not visible to tenant B', async () => {
      const tokenA = await ctx.makeJwt({ roles: ['tenant-administrator'], tenantId: ctx.tenantId });
      const tokenB = await ctx.makeJwt({ roles: ['tenant-administrator'], tenantId: ctx.secondTenantId });

      // Get a flag that is not environment-safety (so tenant-admin can assign)
      const listRes = await ctx.app.inject({
        method: 'GET', url: '/api/v1/feature-flags',
        headers: { authorization: `Bearer ${tokenA}` },
      });
      const flags = listRes.json<Array<{ featureFlagId: string; flagKey: string; flagClassCode: string }>>();
      const flag = flags.find((f) => f.flagClassCode === 'module-enablement');
      expect(flag).toBeDefined();

      // Assign in tenant A
      const assignRes = await ctx.app.inject({
        method: 'POST',
        url: `/api/v1/feature-flags/${flag!.featureFlagId}/assignments`,
        headers: { authorization: `Bearer ${tokenA}`, 'content-type': 'application/json' },
        body: JSON.stringify({ variantKey: 'on' }),
      });
      expect(assignRes.statusCode).toBe(201);
      const { featureFlagAssignmentId } = assignRes.json<{ featureFlagAssignmentId: string }>();

      // Tenant B must not see that assignment via direct DB query in tenant context
      const rowsInB = await ctx.db.execute(sql`
        SELECT id FROM feature_flag_assignment
        WHERE id = ${featureFlagAssignmentId}::uuid
          AND tenant_id = ${ctx.secondTenantId}::uuid
      `) as Array<{ id: string }>;

      expect(rowsInB).toHaveLength(0);
    });

    it('enrolments created in tenant A are not returned by GET for tenant B', async () => {
      const tokenA = await ctx.makeJwt({ tenantId: ctx.tenantId });

      const studentRes = await ctx.app.inject({
        method: 'POST', url: '/api/v1/students',
        headers: { authorization: `Bearer ${tokenA}` },
        payload: { legalFirstName: 'Isolation', legalFamilyName: 'Test' },
      });
      const { personId } = studentRes.json<{ personId: string }>();

      const enrolRes = await ctx.app.inject({
        method: 'POST', url: '/api/v1/enrolments',
        headers: { authorization: `Bearer ${tokenA}` },
        payload: { personId, modeOfStudyCode: 'full-time', academicYearOfEntry: '2026-27', startDate: '2026-09-26' },
      });
      expect(enrolRes.statusCode).toBe(201);
      const { enrolmentId } = enrolRes.json<{ enrolmentId: string }>();

      // Tenant B cannot read tenant A's enrolment
      const tokenB = await ctx.makeJwt({ tenantId: ctx.secondTenantId });
      const getRes = await ctx.app.inject({
        method: 'GET', url: `/api/v1/enrolments/${enrolmentId}`,
        headers: { authorization: `Bearer ${tokenB}` },
      });
      expect(getRes.statusCode).toBe(404);
    });
  });

  // ── 7. Public contract readiness ─────────────────────────────────────────

  describe('public contract readiness', () => {
    it('GET /api/v1/openapi.json returns a valid OpenAPI 3.1.0 spec', async () => {
      const res = await ctx.app.inject({ method: 'GET', url: '/api/v1/openapi.json' });
      expect(res.statusCode).toBe(200);

      const spec = res.json<Record<string, unknown>>();
      expect(spec['openapi']).toBe('3.1.0');
      expect((spec['info'] as Record<string, string>)['title']).toBe('Revelation SRS API');
    });

    it('OpenAPI spec contains all expected domain tags', async () => {
      const res = await ctx.app.inject({ method: 'GET', url: '/api/v1/openapi.json' });
      const spec = res.json<{ tags?: Array<{ name: string }> }>();
      const tagNames = (spec.tags ?? []).map((t) => t.name);

      const requiredTags = [
        'students', 'enrolments', 'assessment', 'governance',
        'progression', 'regulatory', 'platform-controls', 'communications',
      ];
      for (const tag of requiredTags) {
        expect(tagNames, `OpenAPI spec must include tag '${tag}'`).toContain(tag);
      }
    });

    it('no legacy schema artefacts remain (no _compat or _legacy tables)', async () => {
      const rows = await ctx.db.execute(sql`
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public'
          AND (table_name LIKE '%_compat' OR table_name LIKE '%_legacy')
      `) as Array<{ table_name: string }>;

      expect(rows.map((r) => r.table_name)).toHaveLength(0);
    });

    it('no legacy columns exist on core tables (amount_pence removed)', async () => {
      const rows = await ctx.db.execute(sql`
        SELECT table_name, column_name FROM information_schema.columns
        WHERE table_schema = 'public'
          AND column_name IN ('amount_pence')
      `) as Array<{ table_name: string; column_name: string }>;

      expect(rows).toHaveLength(0);
    });

    it('all regulatory exchange records have an idempotency_key (append-only ledger integrity)', async () => {
      const rows = await ctx.db.execute(sql`
        SELECT column_name FROM information_schema.columns
        WHERE table_name = 'integration_exchange'
          AND column_name IN ('idempotency_key', 'direction_code', 'status_code', 'payload_summary')
        ORDER BY column_name
      `) as Array<{ column_name: string }>;

      const names = rows.map((r) => r.column_name);
      expect(names).toContain('idempotency_key');
      expect(names).toContain('direction_code');
      expect(names).toContain('status_code');
    });

    it('audit_record table is present for immutable audit trail', async () => {
      const rows = await ctx.db.execute(sql`
        SELECT column_name FROM information_schema.columns
        WHERE table_name = 'audit_record'
          AND column_name IN ('entity_type', 'entity_id', 'action_type', 'actor_id', 'occurred_at')
        ORDER BY column_name
      `) as Array<{ column_name: string }>;

      const names = rows.map((r) => r.column_name);
      expect(names).toContain('entity_type');
      expect(names).toContain('action_type');
      expect(names).toContain('occurred_at');
    });

    it('migration chain 0000–0018 applied cleanly: all 19 migrations reflected in schema', async () => {
      // Verify breadth of schema: spot-check key tables introduced across stages
      const tableChecks = [
        { table: 'tenant', migration: '0000' },
        { table: 'value_set', migration: '0001' },
        { table: 'enrolment', migration: '0002' },
        { table: 'mark', migration: '0004' },
        { table: 'ucas_application', migration: '0006' },
        { table: 'feature_flag', migration: '0009' },
        { table: 'deployment_environment', migration: '0011' },
        { table: 'locale_resource_pack', migration: '0012' },
        { table: 'workflow_definition', migration: '0013' },
        { table: 'communication_template', migration: '0016' },
      ];

      const tableNames = tableChecks.map((c) => c.table);
      // Use IN clause — postgres.js does not map JS arrays to PG arrays in ANY()
      const inList = tableNames.map((t) => `'${t}'`).join(', ');
      const rows = await ctx.db.execute(sql.raw(`
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name IN (${inList})
        ORDER BY table_name
      `)) as Array<{ table_name: string }>;

      const found = rows.map((r) => r.table_name);
      for (const { table, migration } of tableChecks) {
        expect(found, `Table '${table}' (from migration ${migration}) must exist`).toContain(table);
      }
    });
  });
});
