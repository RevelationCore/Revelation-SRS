import { render, screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { expectNoA11yViolations } from '../../../test/axe.mjs';
import { server } from '../../../test/msw-server.mjs';
import { DemoBanner } from '../src/components/DemoBanner.js';

describe('portal demo context', () => {
  it('keeps Alpha, scenario, version and limitations visible', async () => {
    server.use(
      http.get('http://localhost:3000/api/v1/demo/status', () =>
        HttpResponse.json({ active: true, scenarioName: 'Module Selection', scenarioSlug: 'module-selection', schemaVersion: '0006', demoNow: '2026-06-01T00:00:00Z', nextResetAt: null }),
      ),
    );
    const { container } = render(<DemoBanner />);
    expect(await screen.findByText('Alpha demo')).toBeVisible();
    expect(screen.getByText('Scenario: module-selection')).toBeVisible();
    expect(screen.getByText('Data v0006')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Known limitations' })).toHaveAttribute('target', '_blank');
    await expectNoA11yViolations(container);
  });

  it('stays hidden when no demo scenario is active', async () => {
    let markHandled: () => void = () => {};
    const requestHandled = new Promise<void>((resolve) => { markHandled = resolve; });
    server.use(
      http.get('http://localhost:3000/api/v1/demo/status', () => {
        markHandled();
        return HttpResponse.json({ active: false, scenarioName: null, scenarioSlug: null, schemaVersion: null, demoNow: null, nextResetAt: null });
      }),
    );
    render(<DemoBanner />);
    await requestHandled;
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(screen.queryByText('Alpha demo')).not.toBeInTheDocument();
  });
});
