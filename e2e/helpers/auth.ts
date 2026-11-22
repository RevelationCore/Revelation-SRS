import type { Page } from '@playwright/test';

// ── JWT factory ───────────────────────────────────────────────────────────────
// Creates structurally-valid JWTs without signature verification.
// The admin/portal AuthContext only calls parseJwt (base64url decode of the
// payload) and isTokenExpired (checks exp claim). Neither verifies the signature.

function b64url(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj))
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

function makeJwt(payload: Record<string, unknown>): string {
  const header = b64url({ alg: 'none', typ: 'JWT' });
  const body   = b64url(payload);
  return `${header}.${body}.test-sig`;
}

// Long enough for the suite without overflowing browser timer limits when OIDC is configured.
const EXP = Math.floor(Date.now() / 1000) + 3_600;
const IAT = 1_718_000_000;

export function makeStaffToken(
  roles = ['registry-administrator', 'tenant-administrator', 'system-administrator'],
): string {
  return makeJwt({
    sub:                'test-staff-001',
    preferred_username: 'staff.user',
    given_name:         'Staff',
    family_name:        'User',
    email:              'staff.user@test.ac.uk',
    realm_access:       { roles },
    tenant_id:          'test-tenant-001',
    exp:                EXP,
    iat:                IAT,
  });
}

export const STAFF_TOKEN = makeStaffToken();

export const STUDENT_TOKEN = makeJwt({
  sub:                'test-student-001',
  preferred_username: 'student.user',
  given_name:         'Test',
  family_name:        'Student',
  email:              't.student@test.ac.uk',
  srs_person_id:      'test-student-001',
  realm_access:       { roles: ['student'] },
  tenant_id:          'test-tenant-001',
  exp:                EXP,
  iat:                IAT,
});

// ── Session helpers (ADR-026) ─────────────────────────────────────────────────
// The SPAs hold no token: they read GET /bff/session, and the BFF holds the
// tokens. Mocked UI suites run no BFF, so they answer /bff/session from the
// token's claims; full-stack suites create a real BFF development session.

function claimsOf(token: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString()) as Record<string, unknown>;
}

/** Answers GET /bff/session as the BFF would for this token (mocked UI suites). */
export async function mockSession(page: Page, token: string): Promise<void> {
  const c = claimsOf(token);
  const roles = (c['realm_roles'] as string[] | undefined) ?? (c['realm_access'] as { roles?: string[] } | undefined)?.roles ?? [];
  await page.route('**/bff/session', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({
      authenticated: true, sub: c['sub'], srsPersonId: c['srs_person_id'] ?? null, tenantId: c['tenant_id'] ?? null, roles,
      displayName: c['name'] ?? ([c['given_name'], c['family_name']].filter(Boolean).join(' ') || c['preferred_username']) ?? null, email: c['email'] ?? null,
      expiresAt: new Date(Number(c['exp'] ?? 0) * 1000).toISOString(),
    }),
  }));
}

/**
 * A real BFF development session (POST /bff/dev/session, development and
 * test only) for full-stack suites (BL-162). The cookie lands in the page's
 * browser context, as a real sign-in's would.
 */
export async function devSession(page: Page, appOrigin: string, token: string): Promise<void> {
  const res = await page.request.post(`${appOrigin}/bff/dev/session`, {
    headers: { Origin: appOrigin, 'X-SRS-Request': '1', 'Content-Type': 'application/json' },
    data: { token },
  });
  if (!res.ok()) throw new Error(`BFF development session refused: ${res.status()} ${await res.text()}`);
}

// ── Injection helpers ─────────────────────────────────────────────────────────
// Call before page.goto, so the first /bff/session read is answered.

export async function injectAdminAuth(page: Page, roles?: string[]): Promise<void> {
  await mockSession(page, roles ? makeStaffToken(roles) : STAFF_TOKEN);
}

export async function injectPortalAuth(page: Page): Promise<void> {
  await mockSession(page, STUDENT_TOKEN);
}

/** A portal token for any audience (Phase 5 D-38): an applicant, a supervisor or an examiner. */
export function makePortalToken(roles: string[], personId: string): string {
  return makeJwt({
    sub: `test-${roles[0]}-001`, preferred_username: `${roles[0]}.user`, given_name: 'Test', family_name: roles[0],
    email: `${roles[0]}@test.ac.uk`, srs_person_id: personId, realm_access: { roles }, tenant_id: 'test-tenant-001', exp: EXP, iat: IAT,
  });
}

export async function injectPortalAuthAs(page: Page, roles: string[], personId: string): Promise<void> {
  await mockSession(page, makePortalToken(roles, personId));
}
