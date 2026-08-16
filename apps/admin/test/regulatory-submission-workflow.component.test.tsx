import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { expectNoA11yViolations } from '../../../test/axe.mjs';
import { server } from '../../../test/msw-server.mjs';
import { renderWithProviders } from './render.js';
import { RegulatoryCollectionsPage } from '../src/pages/RegulatoryCollectionsPage.js';

const API = 'http://localhost:3000';
const COLLECTION_ID = 'collection-001';
const SNAPSHOT_ID = 'snapshot-001';

function baseHandlers() {
  return [http.get(`${API}/api/v1/regulatory/collections`, () => HttpResponse.json([]))];
}

async function createDraftCollection() {
  await userEvent.type(screen.getByLabelText(/Regulator code/), 'hesa');
  await userEvent.type(screen.getByLabelText(/Collection type/), 'student-record');
  await userEvent.type(screen.getByLabelText(/Academic year/), '2025/26');
  await userEvent.click(screen.getByRole('button', { name: 'Create collection' }));
  expect(await screen.findByText(COLLECTION_ID)).toBeVisible();
}

describe('regulatory submission workflow', () => {
  it('draft: creating a collection and its snapshot progresses lineage one governed step at a time', async () => {
    server.use(
      ...baseHandlers(),
      http.post(`${API}/api/v1/regulatory/collections`, () => HttpResponse.json({ regulatoryCollectionId: COLLECTION_ID })),
      http.post(`${API}/api/v1/regulatory/collections/${COLLECTION_ID}/snapshots`, () => HttpResponse.json({ collectionSnapshotId: SNAPSHOT_ID })),
    );
    const { container } = renderWithProviders(<RegulatoryCollectionsPage />, { roles: ['regulatory-officer'] });
    await screen.findByText('No collections found.');

    // The snapshot step is not offered until a collection exists.
    expect(screen.queryByText('2. Snapshot source data')).not.toBeInTheDocument();
    await createDraftCollection();

    expect(await screen.findByText('2. Snapshot source data')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Create snapshot' }));
    expect(await screen.findByText(SNAPSHOT_ID)).toBeVisible();

    // Add-records only becomes available once a snapshot exists.
    expect(await screen.findByText('3. Add records')).toBeVisible();
    await expectNoA11yViolations(container);
  });

  it('validation errors: a blocking issue is recorded against the collection before sign-off', async () => {
    let issueBody: unknown;
    server.use(
      ...baseHandlers(),
      http.post(`${API}/api/v1/regulatory/collections`, () => HttpResponse.json({ regulatoryCollectionId: COLLECTION_ID })),
      http.post(`${API}/api/v1/regulatory/collections/${COLLECTION_ID}/validation-issues`, async ({ request }) => {
        issueBody = await request.json();
        return HttpResponse.json({ issueId: 'issue-001' });
      }),
    );
    renderWithProviders(<RegulatoryCollectionsPage />, { roles: ['regulatory-officer'] });
    await screen.findByText('No collections found.');
    await createDraftCollection();

    await userEvent.selectOptions(screen.getByLabelText('Severity'), 'blocking');
    await userEvent.type(screen.getByLabelText(/Message/), 'Missing HESA identifier');
    await userEvent.click(screen.getByRole('button', { name: 'Add issue' }));

    expect(await screen.findByText('1 issue(s) recorded this session.')).toBeVisible();
    expect(issueBody).toMatchObject({ severityCode: 'blocking', message: 'Missing HESA identifier' });
  });

  it('approval: sign-off is a distinct, visible step that precedes submission', async () => {
    server.use(
      ...baseHandlers(),
      http.post(`${API}/api/v1/regulatory/collections`, () => HttpResponse.json({ regulatoryCollectionId: COLLECTION_ID })),
      http.post(`${API}/api/v1/regulatory/collections/${COLLECTION_ID}/signoff`, () => HttpResponse.json({ signoffId: 'signoff-001' })),
    );
    renderWithProviders(<RegulatoryCollectionsPage />, { roles: ['regulatory-officer'] });
    await screen.findByText('No collections found.');
    await createDraftCollection();

    await screen.findByText('5. Sign off');
    await userEvent.click(screen.getByRole('button', { name: 'Sign off' }));
    expect(await screen.findByText('Collection signed off.')).toBeVisible();
  });

  it('submitted: submitting after a snapshot exists records the exchange as sent', async () => {
    let submitBody: unknown;
    server.use(
      ...baseHandlers(),
      http.post(`${API}/api/v1/regulatory/collections`, () => HttpResponse.json({ regulatoryCollectionId: COLLECTION_ID })),
      http.post(`${API}/api/v1/regulatory/collections/${COLLECTION_ID}/snapshots`, () => HttpResponse.json({ collectionSnapshotId: SNAPSHOT_ID })),
      http.post(`${API}/api/v1/regulatory/collections/${COLLECTION_ID}/submit`, async ({ request }) => {
        submitBody = await request.json();
        return HttpResponse.json({ submissionId: 'submission-001' });
      }),
    );
    renderWithProviders(<RegulatoryCollectionsPage />, { roles: ['regulatory-officer'] });
    await screen.findByText('No collections found.');
    await createDraftCollection();
    await userEvent.click(screen.getByRole('button', { name: 'Create snapshot' }));
    await screen.findByText(SNAPSHOT_ID);

    await screen.findByText('6. Submit to regulator');
    await userEvent.click(screen.getByRole('button', { name: 'Submit' }));

    expect(await screen.findByText('Collection submitted.')).toBeVisible();
    expect(submitBody).toMatchObject({ collectionSnapshotId: SNAPSHOT_ID });
  });

  it('failed exchange: a rejected submission surfaces the regulator-supplied reason and stays retryable', async () => {
    server.use(
      ...baseHandlers(),
      http.post(`${API}/api/v1/regulatory/collections`, () => HttpResponse.json({ regulatoryCollectionId: COLLECTION_ID })),
      http.post(`${API}/api/v1/regulatory/collections/${COLLECTION_ID}/snapshots`, () => HttpResponse.json({ collectionSnapshotId: SNAPSHOT_ID })),
      http.post(`${API}/api/v1/regulatory/collections/${COLLECTION_ID}/submit`, () => HttpResponse.json({ type: 'about:blank', title: 'Bad Gateway', detail: 'The regulator exchange endpoint timed out. Retry once connectivity is restored.' }, { status: 502 })),
    );
    renderWithProviders(<RegulatoryCollectionsPage />, { roles: ['regulatory-officer'] });
    await screen.findByText('No collections found.');
    await createDraftCollection();
    await userEvent.click(screen.getByRole('button', { name: 'Create snapshot' }));
    await screen.findByText(SNAPSHOT_ID);
    await screen.findByText('6. Submit to regulator');
    await userEvent.click(screen.getByRole('button', { name: 'Submit' }));

    expect(await screen.findByText('The regulator exchange endpoint timed out. Retry once connectivity is restored.')).toBeVisible();
    // The retry affordance is unambiguous: the same Submit control remains, not replaced by a dead end.
    expect(screen.getByRole('button', { name: 'Submit' })).toBeEnabled();
  });
});
