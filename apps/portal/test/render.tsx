import type { ReactElement } from 'react';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { initI18n } from '@revelation-srs/ui';
import { http, HttpResponse } from 'msw';
import { server } from '../../../test/msw-server.mjs';
import { AuthProvider } from '../src/auth/AuthContext.js';
import { Codes } from '../src/codes.js';

initI18n('en-GB');

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
  // ADR-026: the app reads its session from the BFF; no token in the browser.
  server.use(http.get('*/bff/session', () => HttpResponse.json(roles.length > 0
    ? { authenticated: true, sub: 'test-user-001', tenantId, roles, displayName: 'Test User', email: 'test.user@test.ac.uk', srsPersonId }
    : { authenticated: false })));
  return render(
    <MemoryRouter initialEntries={[route]}>
      <AuthProvider><Codes>{ui}</Codes></AuthProvider>
    </MemoryRouter>,
  );
}
