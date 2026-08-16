function b64url(value) {
  return btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

/**
 * Build an unsigned JWT shaped like the ones the real Keycloak/OIDC flow issues
 * (see e2e/helpers/auth.ts for the browser-level equivalent), for seeding
 * component-test auth state without a running identity provider.
 */
export function fakeJwt({ roles = [], tenantId = 'test-tenant-001', srsPersonId, ...claims } = {}) {
  const header = b64url({ alg: 'none', typ: 'JWT' });
  const body = b64url({
    sub: 'test-user-001',
    preferred_username: 'test.user',
    given_name: 'Test',
    family_name: 'User',
    email: 't.user@test.ac.uk',
    realm_access: { roles },
    tenant_id: tenantId,
    ...(srsPersonId ? { srs_person_id: srsPersonId } : {}),
    // A near-future (not far-future) expiry: AuthContext schedules a refresh
    // timer at (exp - 60)s from now, and Node's setTimeout silently clamps
    // any delay over ~24.8 days (2^31-1 ms) to 1ms — a huge exp fires an
    // immediate, unwanted token-refresh request against the real OIDC token
    // endpoint during a test.
    exp: Math.floor(Date.now() / 1000) + 3600,
    iat: Math.floor(Date.now() / 1000) - 60,
    ...claims,
  });
  return `${header}.${body}.fake-sig`;
}
