import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { expectNoA11yViolations } from '../../../test/axe.mjs';
import { server } from '../../../test/msw-server.mjs';
import { renderWithProviders } from './render.js';
import { EnvironmentRuntimePage } from '../src/pages/EnvironmentRuntimePage.js';

/** BL-402 (UAT OP-08): a deployment whose environment is not registered. */
const API = 'http://localhost:3000/bff/srs';

const runtime = {
  environmentCode: 'local', registered: false, environment: null,
  releaseVersion: '0.1.0', imageDigest: null, migrationVersion: '0010_adjustment_migration_release',
  workflowDefinitions: [{ definitionCode: 'ec-determination', currentVersionNumber: 1 }],
  featureFlags: [],
};

describe('environment runtime', () => {
  it('shows an unregistered environment as a state, with how to register it, and the rest of the report', async () => {
    server.use(http.get(`${API}/api/v1/environment-runtime`, () => HttpResponse.json(runtime)));
    const { container } = renderWithProviders(<EnvironmentRuntimePage />, { roles: ['tenant-administrator'] });

    const notice = (await screen.findByText(/which is not registered/)).closest('[role="status"]');
    expect(notice).toHaveTextContent('This deployment runs as local, which is not registered.');
    expect(notice).toHaveTextContent('SRS_ENVIRONMENT_CODE');
    expect(screen.getByText('local (not registered)')).toBeInTheDocument();
    expect(screen.getByText('0010_adjustment_migration_release')).toBeInTheDocument();
    expect(screen.getByText('ec-determination')).toBeInTheDocument();
    expect(screen.queryByText(/Failed to load runtime/)).not.toBeInTheDocument();
    await expectNoA11yViolations(container);
  });
});
