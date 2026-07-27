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

export const STAFF_TOKEN = makeJwt({
  sub:                'test-staff-001',
  preferred_username: 'staff.user',
  given_name:         'Staff',
  family_name:        'User',
  email:              'staff.user@test.ac.uk',
  realm_access:       { roles: ['registry-administrator', 'tenant-administrator', 'system-administrator'] },
  tenant_id:          'test-tenant-001',
  exp:                EXP,
  iat:                IAT,
});

export const STUDENT_TOKEN = makeJwt({
  sub:                'test-student-001',
  preferred_username: 'student.user',
  given_name:         'Test',
  family_name:        'Student',
  email:              't.student@test.ac.uk',
  realm_access:       { roles: ['student'] },
  tenant_id:          'test-tenant-001',
  exp:                EXP,
  iat:                IAT,
});

// ── Injection helpers ─────────────────────────────────────────────────────────
// Must be called before page.goto so addInitScript runs on the first load.

export async function injectAdminAuth(page: Page): Promise<void> {
  await page.addInitScript(
    ({ token }: { token: string }) => {
      localStorage.setItem('srs_admin_token',         token);
      localStorage.setItem('srs_admin_refresh_token', token);
    },
    { token: STAFF_TOKEN },
  );
}

export async function injectPortalAuth(page: Page): Promise<void> {
  await page.addInitScript(
    ({ token }: { token: string }) => {
      localStorage.setItem('srs_portal_token',         token);
      localStorage.setItem('srs_portal_refresh_token', token);
    },
    { token: STUDENT_TOKEN },
  );
}
