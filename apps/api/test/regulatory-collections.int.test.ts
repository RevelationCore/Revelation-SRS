import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startTestApp, type TestApp } from './helpers/test-app.js';

let ctx: TestApp;
let jwt: string;

beforeAll(async () => {
  ctx = await startTestApp();
  jwt = await ctx.makeJwt();
}, 120_000);

afterAll(async () => { await ctx?.teardown(); });

describe('Regulatory collection & lineage (BPR-D16)', () => {
  it('creates an SFC collection, snapshots it, adds a record with lineage, signs off and submits', async () => {
    const collection = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/regulatory/collections',
      headers: { authorization: `Bearer ${jwt}` },
      payload: { regulatorCode: 'SFC', collectionTypeCode: 'annual-return', academicYear: '2027-28' },
    });
    expect(collection.statusCode).toBe(201);
    const { regulatoryCollectionId } = collection.json<{ regulatoryCollectionId: string }>();

    const snapshot = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/regulatory/collections/${regulatoryCollectionId}/snapshots`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: { sourceTransactionTime: new Date().toISOString() },
    });
    expect(snapshot.statusCode).toBe(201);
    const { collectionSnapshotId } = snapshot.json<{ collectionSnapshotId: string }>();

    const record = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/regulatory/snapshots/${collectionSnapshotId}/records`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: { recordPayload: { studentCount: 42 } },
    });
    expect(record.statusCode).toBe(201);

    const signoff = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/regulatory/collections/${regulatoryCollectionId}/signoff`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: { commentary: 'Reviewed and approved' },
    });
    expect(signoff.statusCode).toBe(201);

    const submit = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/regulatory/collections/${regulatoryCollectionId}/submit`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: { collectionSnapshotId },
    });
    expect(submit.statusCode).toBe(201);
  });

  it('blocks sign-off when a blocking validation issue is open', async () => {
    const collection = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/regulatory/collections',
      headers: { authorization: `Bearer ${jwt}` },
      payload: { regulatorCode: 'MEDR', collectionTypeCode: 'annual-return', academicYear: '2027-28' },
    });
    expect(collection.statusCode).toBe(201);
    const { regulatoryCollectionId } = collection.json<{ regulatoryCollectionId: string }>();

    const issue = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/regulatory/collections/${regulatoryCollectionId}/validation-issues`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: { severityCode: 'blocking', message: 'Missing domicile code for 3 records' },
    });
    expect(issue.statusCode).toBe(201);

    const signoff = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/regulatory/collections/${regulatoryCollectionId}/signoff`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: {},
    });
    expect(signoff.statusCode).toBe(422);
  });

  it('lists collections and can filter by regulator', async () => {
    const collection = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/regulatory/collections',
      headers: { authorization: `Bearer ${jwt}` },
      payload: { regulatorCode: 'DFE-NI', collectionTypeCode: 'annual-return', academicYear: '2027-28' },
    });
    expect(collection.statusCode).toBe(201);
    const { regulatoryCollectionId } = collection.json<{ regulatoryCollectionId: string }>();

    const list = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/regulatory/collections?regulatorCode=DFE-NI',
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(list.statusCode).toBe(200);
    expect(list.json<Array<{ regulatoryCollectionId: string; regulatorCode: string; statusCode: string }>>())
      .toContainEqual(expect.objectContaining({ regulatoryCollectionId, regulatorCode: 'DFE-NI', statusCode: 'draft' }));
  });
});
