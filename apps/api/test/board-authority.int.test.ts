import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startTestApp, type TestApp } from './helpers/test-app.js';

let ctx: TestApp;
let jwt: string;

beforeAll(async () => {
  ctx = await startTestApp();
  jwt = await ctx.makeJwt();
}, 120_000);

afterAll(async () => {
  await ctx?.teardown();
});

async function createAcademicPeriod(code: string): Promise<string> {
  const period = await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/academic-periods',
    headers: { authorization: `Bearer ${jwt}` },
    payload: {
      academicYear: '2027-28',
      periodCode: `${code}-SEM1`,
      periodTypeCode: 'semester',
      startDate: '2027-09-20',
      endDate: '2028-01-14',
    },
  });
  expect(period.statusCode).toBe(201);
  return period.json<{ academicPeriodId: string }>().academicPeriodId;
}

async function createBoard(academicPeriodId: string): Promise<string> {
  const board = await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/exam-boards',
    headers: { authorization: `Bearer ${jwt}` },
    payload: { boardTypeCode: 'module', academicYear: '2027-28', academicPeriodId, meetingDate: '2028-02-10' },
  });
  expect(board.statusCode).toBe(201);
  return board.json<{ examBoardId: string }>().examBoardId;
}

async function generatePack(examBoardId: string): Promise<string> {
  const pack = await ctx.app.inject({
    method: 'POST',
    url: `/api/v1/exam-boards/${examBoardId}/data-pack`,
    headers: { authorization: `Bearer ${jwt}` },
  });
  expect(pack.statusCode).toBe(201);
  return pack.json<{ dataPackId: string }>().dataPackId;
}

describe('Board authority & ratification (BPR-D11)', () => {
  it('declares a conflict, records quorum, decides, ratifies, and publishes', async () => {
    const academicPeriodId = await createAcademicPeriod('BA101');
    const examBoardId = await createBoard(academicPeriodId);
    const dataPackId = await generatePack(examBoardId);

    const conflict = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/exam-boards/${examBoardId}/conflicts`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: { conflictTypeCode: 'family' },
    });
    expect(conflict.statusCode).toBe(201);
    const { conflictId } = conflict.json<{ conflictId: string }>();

    const recuse = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/v1/board-conflicts/${conflictId}/recuse`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(recuse.statusCode).toBe(204);

    const quorum = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/exam-boards/${examBoardId}/quorum-decision`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: { requiredCount: 3, attendingCount: 4 },
    });
    expect(quorum.statusCode).toBe(201);
    expect(quorum.json<{ quorumMet: boolean }>().quorumMet).toBe(true);

    const decision = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/exam-boards/${examBoardId}/decisions`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: { dataPackId, decisionTypeCode: 'ratify', rationale: 'All candidates meet the pass criteria' },
    });
    expect(decision.statusCode).toBe(201);
    const { decisionId } = decision.json<{ decisionId: string }>();

    const ratification = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/board-decisions/${decisionId}/ratification`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(ratification.statusCode).toBe(201);
    const { ratificationRecordId } = ratification.json<{ ratificationRecordId: string }>();

    const publish = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/v1/ratification-records/${ratificationRecordId}/publish`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(publish.statusCode).toBe(204);

    // Publishing twice is rejected — the publication is no longer 'locked'.
    const publishAgain = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/v1/ratification-records/${ratificationRecordId}/publish`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(publishAgain.statusCode).toBe(422);
  });

  it('rejects a ratification record request for a non-ratify decision', async () => {
    const academicPeriodId = await createAcademicPeriod('BA102');
    const examBoardId = await createBoard(academicPeriodId);
    const dataPackId = await generatePack(examBoardId);

    const decision = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/exam-boards/${examBoardId}/decisions`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: { dataPackId, decisionTypeCode: 'defer', rationale: 'Awaiting late evidence' },
    });
    expect(decision.statusCode).toBe(201);
    const { decisionId } = decision.json<{ decisionId: string }>();

    const ratification = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/board-decisions/${decisionId}/ratification`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(ratification.statusCode).toBe(422);
  });
});
