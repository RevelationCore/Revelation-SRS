import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import {
  createPostgresDocumentAdapter,
  DocumentNotFoundError,
  DocumentTooLargeError,
  DocumentTypeNotAllowedError,
  documents,
  documentAccessLog,
} from '../src/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const TENANT_ID = '00000000-0000-0000-0000-000000000001';
const ACTOR_ID  = 'test-actor-001';

let container: StartedPostgreSqlContainer;
let client:    ReturnType<typeof postgres>;
let db:        ReturnType<typeof drizzle>;

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').withDatabase('documents_test').start();
  client    = postgres(container.getConnectionUri(), { max: 5 });
  db        = drizzle(client, { schema: { documents, documentAccessLog } });

  const ddl = await readFile(join(__dirname, 'fixtures/schema.sql'), 'utf8');
  await client.unsafe(ddl);
}, 120_000);

afterAll(async () => {
  await client.end();
  await container.stop();
});

describe('createPostgresDocumentAdapter', () => {
  it('stores a document and computes its checksum', async () => {
    const adapter = createPostgresDocumentAdapter(db);
    const content  = Buffer.from('a DSA needs-assessment report');

    const result = await adapter.store({
      tenantId:     TENANT_ID,
      ownerService: 'wellbeing',
      ownerRef:     'case-001',
      filename:     'assessment.pdf',
      mimeType:     'application/pdf',
      content,
      actorId:      ACTOR_ID,
    });

    expect(result.documentId).toBeTruthy();
    expect(result.checksumSha256).toBe(createHash('sha256').update(content).digest('hex'));
    expect(result.sizeBytes).toBe(content.byteLength);
    expect(result.statusCode).toBe('clean');
  });

  it('retrieves stored content byte-for-byte and logs the access', async () => {
    const adapter = createPostgresDocumentAdapter(db);
    const content  = Buffer.from('evidence content for retrieval test');

    const stored = await adapter.store({
      tenantId: TENANT_ID, ownerService: 'wellbeing', ownerRef: 'case-002',
      filename: 'evidence.pdf', mimeType: 'application/pdf', content, actorId: ACTOR_ID,
    });

    const retrieved = await adapter.retrieve(TENANT_ID, stored.documentId, 'downloader-001');
    expect(retrieved.content.equals(content)).toBe(true);
    expect(retrieved.filename).toBe('evidence.pdf');

    const logRows = await db.select().from(documentAccessLog).where(sql`document_id = ${stored.documentId}`);
    const actions = logRows.map(r => r.action).sort();
    expect(actions).toEqual(['retrieve', 'store']);
  });

  it('rejects a document over the configured size limit', async () => {
    const adapter = createPostgresDocumentAdapter(db, { maxBytes: 10 });
    await expect(adapter.store({
      tenantId: TENANT_ID, ownerService: 'wellbeing', ownerRef: 'case-003',
      filename: 'too-big.pdf', mimeType: 'application/pdf',
      content: Buffer.alloc(11), actorId: ACTOR_ID,
    })).rejects.toBeInstanceOf(DocumentTooLargeError);
  });

  it('rejects a disallowed mime type', async () => {
    const adapter = createPostgresDocumentAdapter(db);
    await expect(adapter.store({
      tenantId: TENANT_ID, ownerService: 'wellbeing', ownerRef: 'case-004',
      filename: 'script.exe', mimeType: 'application/x-msdownload',
      content: Buffer.from('x'), actorId: ACTOR_ID,
    })).rejects.toBeInstanceOf(DocumentTypeNotAllowedError);
  });

  it('soft-deletes: content is gone, metadata and access log survive', async () => {
    const adapter = createPostgresDocumentAdapter(db);
    const stored = await adapter.store({
      tenantId: TENANT_ID, ownerService: 'wellbeing', ownerRef: 'case-005',
      filename: 'to-delete.pdf', mimeType: 'application/pdf',
      content: Buffer.from('will be deleted'), actorId: ACTOR_ID,
    });

    await adapter.softDelete(TENANT_ID, stored.documentId, 'deleter-001', 'retention period expired');

    await expect(adapter.retrieve(TENANT_ID, stored.documentId, ACTOR_ID)).rejects.toBeInstanceOf(DocumentNotFoundError);

    const meta = await adapter.getMetadata(TENANT_ID, stored.documentId);
    expect(meta.deletedAt).not.toBeNull();

    const logRows = await db.select().from(documentAccessLog).where(sql`document_id = ${stored.documentId}`);
    expect(logRows.map(r => r.action).sort()).toEqual(['delete', 'store']);
  });

  it('lists documents scoped to owner service + ref, excluding deleted ones', async () => {
    const adapter = createPostgresDocumentAdapter(db);
    const a = await adapter.store({
      tenantId: TENANT_ID, ownerService: 'wellbeing', ownerRef: 'case-006',
      filename: 'a.pdf', mimeType: 'application/pdf', content: Buffer.from('a'), actorId: ACTOR_ID,
    });
    const b = await adapter.store({
      tenantId: TENANT_ID, ownerService: 'wellbeing', ownerRef: 'case-006',
      filename: 'b.pdf', mimeType: 'application/pdf', content: Buffer.from('b'), actorId: ACTOR_ID,
    });
    const c = await adapter.store({
      tenantId: TENANT_ID, ownerService: 'wellbeing', ownerRef: 'case-006',
      filename: 'c.pdf', mimeType: 'application/pdf', content: Buffer.from('c'), actorId: ACTOR_ID,
    });
    await adapter.softDelete(TENANT_ID, c.documentId, ACTOR_ID, 'test cleanup');

    const listed = await adapter.listByOwner(TENANT_ID, 'wellbeing', 'case-006');
    expect(listed.map(d => d.documentId).sort()).toEqual([a.documentId, b.documentId].sort());
  });

  it('scopes retrieval to the correct tenant', async () => {
    const adapter = createPostgresDocumentAdapter(db);
    const stored = await adapter.store({
      tenantId: TENANT_ID, ownerService: 'wellbeing', ownerRef: 'case-007',
      filename: 'tenant-scoped.pdf', mimeType: 'application/pdf', content: Buffer.from('x'), actorId: ACTOR_ID,
    });

    await expect(adapter.retrieve('00000000-0000-0000-0000-000000000099', stored.documentId, ACTOR_ID))
      .rejects.toBeInstanceOf(DocumentNotFoundError);
  });
});
