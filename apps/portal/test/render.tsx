import type { ReactElement } from 'react';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { initI18n } from '@revelation-srs/ui';
import { fakeJwt } from '../../../test/fake-jwt.mjs';
import { AuthProvider } from '../src/auth/AuthContext.js';

initI18n('en-GB');

const ACCESS_KEY = 'srs_portal_token';
const REFRESH_KEY = 'srs_portal_refresh_token';

interface RenderWithProvidersOptions {
  /** Realm roles the signed-in student/staff user holds; empty means signed out. */
  roles?: string[];
  route?: string;
  tenantId?: string;
  /** SRS person UUID — student-facing routes must key off this, not the Keycloak `sub` claim. */
  srsPersonId?: string;
}

/** Render a page/component as an authenticated portal user inside the real router and auth providers. */
export function renderWithProviders(ui: ReactElement, { roles = ['student'], route = '/', tenantId = 'test-tenant-001', srsPersonId = 'test-student-001' }: RenderWithProvidersOptions = {}) {
  if (roles.length > 0) {
    const token = fakeJwt({ roles, tenantId, srsPersonId });
    localStorage.setItem(ACCESS_KEY, token);
    localStorage.setItem(REFRESH_KEY, token);
  } else {
    localStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem(REFRESH_KEY);
  }
  return render(
    <MemoryRouter initialEntries={[route]}>
      <AuthProvider>{ui}</AuthProvider>
    </MemoryRouter>,
  );
}
