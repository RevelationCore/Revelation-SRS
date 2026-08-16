import { Route, Routes } from 'react-router-dom';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { expectNoA11yViolations } from '../../../test/axe.mjs';
import { server } from '../../../test/msw-server.mjs';
import { renderWithProviders } from './render.js';
import { ExamBoardDetailPage } from '../src/pages/ExamBoardDetailPage.js';

const API = 'http://localhost:3000';
const BOARD_ID = 'board-001';
const ROUTE = `/exam-boards/${BOARD_ID}`;

const board = {
  examBoardId: BOARD_ID, boardTypeCode: 'progression', academicYear: '2025/26', academicPeriodId: null, periodCode: null,
  meetingDate: '2026-06-01', ratifiedAt: null, deferredAt: null, deferralReason: null, quorumCount: null, quorumRecordedAt: null,
  actorId: 'staff-001', createdAt: '2026-01-01T00:00:00Z',
};

function baseHandlers() {
  return [
    http.get(`${API}/api/v1/exam-boards/${BOARD_ID}`, () => HttpResponse.json(board)),
    // The overview tab (the default tab, mounted before any test switches
    // away from it) always requests the data pack; a 404 is a normal "no
    // pack generated yet" response the page already handles.
    http.get(`${API}/api/v1/exam-boards/${BOARD_ID}/data-pack`, () => HttpResponse.json({ type: 'about:blank', title: 'Not Found' }, { status: 404 })),
  ];
}

async function openAuthorityTab() {
  await screen.findByRole('heading', { name: /progression/i });
  await userEvent.click(screen.getByRole('tab', { name: 'Board authority' }));
  await screen.findByText('Conflicts of interest');
}

describe('exam-board authority workflow', () => {
  it('read-only: a user without exam-board:ratify sees the permission boundary, not the authority controls', async () => {
    server.use(...baseHandlers());
    renderWithProviders(<Routes><Route path="/exam-boards/:boardId" element={<ExamBoardDetailPage />} /></Routes>, { roles: ['exam-board-member'], route: ROUTE });
    await screen.findByRole('heading', { name: /progression/i });
    await userEvent.click(screen.getByRole('tab', { name: 'Board authority' }));

    expect(await screen.findByText(/You do not have the exam-board:ratify permission/)).toBeVisible();
    expect(screen.queryByText('Conflicts of interest')).not.toBeInTheDocument();
  });

  it('conflict: declaring a conflict then recusing the member both persist and update the visible state', async () => {
    server.use(
      ...baseHandlers(),
      http.post(`${API}/api/v1/exam-boards/${BOARD_ID}/conflicts`, () => HttpResponse.json({ conflictId: 'conflict-001' })),
      http.patch(`${API}/api/v1/board-conflicts/conflict-001/recuse`, () => new HttpResponse(null, { status: 204 })),
    );
    const { container } = renderWithProviders(<Routes><Route path="/exam-boards/:boardId" element={<ExamBoardDetailPage />} /></Routes>, { roles: ['exam-board-chair'], route: ROUTE });
    await openAuthorityTab();
    await expectNoA11yViolations(container);

    await userEvent.type(screen.getByLabelText(/Conflict type/), 'personal-relationship');
    await userEvent.click(screen.getByRole('button', { name: 'Declare conflict' }));

    expect(await screen.findByText('conflict-001')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Recuse member' }));
    expect(await screen.findByText('Member recused.')).toBeVisible();
  });

  it('quorum: recording quorum shows whether it was met', async () => {
    server.use(
      ...baseHandlers(),
      http.post(`${API}/api/v1/exam-boards/${BOARD_ID}/quorum-decision`, () => HttpResponse.json({ quorumDecisionId: 'quorum-001', quorumMet: true })),
    );
    renderWithProviders(<Routes><Route path="/exam-boards/:boardId" element={<ExamBoardDetailPage />} /></Routes>, { roles: ['exam-board-chair'], route: ROUTE });
    await openAuthorityTab();

    await userEvent.type(screen.getByLabelText(/Required count/), '5');
    await userEvent.type(screen.getByLabelText(/Attending count/), '6');
    await userEvent.click(screen.getByRole('button', { name: 'Record quorum' }));

    expect(await screen.findByText(/Quorum met/)).toBeVisible();
  });

  it('decision → ratification → publish: the full authority chain progresses one governed step at a time', async () => {
    server.use(
      ...baseHandlers(),
      http.post(`${API}/api/v1/exam-boards/${BOARD_ID}/decisions`, () => HttpResponse.json({ decisionId: 'decision-001' })),
      http.post(`${API}/api/v1/board-decisions/decision-001/ratification`, () => HttpResponse.json({ ratificationRecordId: 'ratification-001' })),
      http.patch(`${API}/api/v1/ratification-records/ratification-001/publish`, () => new HttpResponse(null, { status: 204 })),
    );
    renderWithProviders(<Routes><Route path="/exam-boards/:boardId" element={<ExamBoardDetailPage />} /></Routes>, { roles: ['exam-board-chair'], route: ROUTE });
    await openAuthorityTab();

    // Ratification and publish are not offered until each prior governed step exists.
    expect(screen.queryByRole('button', { name: 'Create ratification record' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Publish results' })).not.toBeInTheDocument();

    await userEvent.type(screen.getByLabelText(/Data pack ID/), 'pack-001');
    await userEvent.click(screen.getByRole('button', { name: 'Record decision' }));
    expect(await screen.findByText('decision-001')).toBeVisible();

    await userEvent.click(screen.getByRole('button', { name: 'Create ratification record' }));
    expect(await screen.findByText('ratification-001')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Create ratification record' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Publish results' }));
    expect(await screen.findByText('Results published.')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Publish results' })).not.toBeInTheDocument();
  });

  it('API failure: a rejected decision keeps the form visible with the server-provided reason', async () => {
    server.use(
      ...baseHandlers(),
      http.post(`${API}/api/v1/exam-boards/${BOARD_ID}/decisions`, () => HttpResponse.json({ type: 'about:blank', title: 'Conflict', detail: 'An unresolved conflict of interest blocks this decision.' }, { status: 409 })),
    );
    renderWithProviders(<Routes><Route path="/exam-boards/:boardId" element={<ExamBoardDetailPage />} /></Routes>, { roles: ['exam-board-chair'], route: ROUTE });
    await openAuthorityTab();

    await userEvent.type(screen.getByLabelText(/Data pack ID/), 'pack-001');
    await userEvent.click(screen.getByRole('button', { name: 'Record decision' }));

    expect(await screen.findByText('An unresolved conflict of interest blocks this decision.')).toBeVisible();
    expect(screen.getByLabelText(/Data pack ID/)).toBeVisible();
  });
});
