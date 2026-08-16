import type { ReactElement } from 'react';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { initI18n } from '@revelation-srs/ui';
import { fakeJwt } from '../../../test/fake-jwt.mjs';
import { AuthProvider } from '../src/auth/AuthContext.js';

initI18n('en-GB');

const ACCESS_KEY = 'srs_admin_token';
const REFRESH_KEY = 'srs_admin_refresh_token';

interface RenderWithProvidersOptions {
  /** Realm roles the signed-in staff user holds; empty means signed out. */
  roles?: string[];
  route?: string;
  tenantId?: string;
}

/** Render a page/component as an authenticated staff user inside the real router and auth providers. */
export function renderWithProviders(ui: ReactElement, { roles = [], route = '/', tenantId = 'test-tenant-001' }: RenderWithProvidersOptions = {}) {
  if (roles.length > 0) {
    const token = fakeJwt({ roles, tenantId });
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
