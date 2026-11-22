/**
 * The document store (ADR-030): every upload is scanned before it is stored,
 * an infected upload keeps its metadata but never its content, and only
 * clean or system-generated content is served. Also the storage behaviour
 * the adapter always had (checksums, access log, soft delete, tenancy).
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  createDocumentStore,
  DocumentNotAvailableError,
  DocumentNotFoundError,
  DocumentRejectedError,
  DocumentScannerUnavailableError,
  DocumentTooLargeError,
  DocumentTypeNotAllowedError,
  documentAccessLog,
  documents,
  NoopScanner,
  RejectingScanner,
  type DocumentScanner,
  type DocumentSecurityObserver,
  type ScannedUpload,
  type ScanVerdict,
} from '../src/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TENANT_ID = '00000000-0000-0000-0000-000000000001';
const ACTOR_ID  = 'test-actor-001';

let container: StartedPostgreSqlContainer;
let client:    ReturnType<typeof postgres>;
let db:        ReturnType<typeof drizzle<{ documents: typeof documents; documentAccessLog: typeof documentAccessLog }>>;
let events:    Array<{ kind: string; [k: string]: unknown }>;

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').withDatabase('documents_test').start();
  client    = postgres(container.getConnectionUri(), { max: 5 });
  db        = drizzle(client, { schema: { documents, documentAccessLog } });
  await client.unsafe(await readFile(join(__dirname, 'fixtures/schema.sql'), 'utf8'));
}, 120_000);
afterAll(async () => { await client.end(); await container.stop(); });
beforeEach(() => { events = []; });

const observer: DocumentSecurityObserver = {
  uploadRejected: (e) => events.push({ kind: 'uploadRejected', ...e }),
  scannerUnavailable: (e) => events.push({ kind: 'scannerUnavailable', ...e }),
  retrievalRefused: (e) => events.push({ kind: 'retrievalRefused', ...e }),
  scanned: (e) => events.push({ kind: 'scanned', ...e }),
  rescanInfected: (e) => events.push({ kind: 'rescanInfected', ...e }),
};

/** A scanner that calls anything containing EICAR infected. */
class FakeScanner implements DocumentScanner {
  readonly engine = 'fake';
  calls = 0;
  // eslint-disable-next-line @typescript-eslint/require-await
  async scan(content: Buffer): Promise<ScanVerdict> {
    this.calls++;
    return content.includes('EICAR')
      ? { verdict: 'infected', engine: this.engine, databaseVersion: 'fake/1', signature: 'Eicar-Test-Signature' }
      : { verdict: 'clean', engine: this.engine, databaseVersion: 'fake/1' };
  }
}

const storeWith = (scanner: DocumentScanner, opts: { maxBytes?: number } = {}) => createDocumentStore({
  scanner, observer, runInTenant: (_tenantId, fn) => db.transaction((tx) => fn(tx)), ...opts,
});
const upload = (ownerRef: string, content: string | Buffer, extra: Partial<{ filename: string; mimeType: string; tenantId: string }> = {}) => ({
  tenantId: TENANT_ID, ownerService: 'wellbeing', ownerRef, filename: 'evidence.pdf', mimeType: 'application/pdf',
  content: Buffer.isBuffer(content) ? content : Buffer.from(content), actorId: ACTOR_ID, ...extra,
});
const actions = async (documentId: string) =>
  (await db.select().from(documentAccessLog).where(sql`document_id = ${documentId}`)).map((r) => r.action).sort();

describe('scanning before storing (ADR-030)', () => {
  it('stores a scanned upload as clean, with the scan recorded', async () => {
    const store = storeWith(new FakeScanner());
    const content = Buffer.from('a DSA needs-assessment report');
    const stored = await store.adapter(db).store(await store.scanUpload(upload('case-001', content)));
    expect(stored).toMatchObject({ checksumSha256: createHash('sha256').update(content).digest('hex'), sizeBytes: content.byteLength, statusCode: 'clean' });
    const [row] = await db.select().from(documents).where(sql`id = ${stored.documentId}`);
    expect(row).toMatchObject({ scanEngine: 'fake', scanDatabaseVersion: 'fake/1', scanSignature: null });
    expect(row!.scannedAt).toBeInstanceOf(Date);
  });

  it('refuses anything the store did not issue', async () => {
    const store = storeWith(new FakeScanner());
    const forged = { input: upload('case-forged', 'x'), checksumSha256: 'x', verdict: { verdict: 'clean', engine: 'x', databaseVersion: null }, scannedAt: new Date() } as unknown as ScannedUpload;
    await expect(store.adapter(db).store(forged)).rejects.toBeInstanceOf(TypeError);
    const issued = await store.scanUpload(upload('case-forged', 'x'));
    await expect(store.adapter(db).store({ ...issued })).rejects.toBeInstanceOf(TypeError);
  });

  it('keeps the metadata of an infected upload, never its content, and says why', async () => {
    const store = storeWith(new FakeScanner());
    const err = await store.scanUpload(upload('case-inf', 'X5O EICAR test')).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DocumentRejectedError);
    expect((err as Error).message).not.toContain('Eicar');
    const { documentId } = err as DocumentRejectedError;
    const [row] = await db.select().from(documents).where(sql`id = ${documentId}`);
    expect(row).toMatchObject({ statusCode: 'infected', content: null, scanSignature: 'Eicar-Test-Signature', ownerRef: 'case-inf' });
    expect(await actions(documentId)).toEqual(['upload-rejected']);
    expect(events.find((e) => e.kind === 'uploadRejected')).toMatchObject({ documentId, signature: 'Eicar-Test-Signature' });
    expect(events.find((e) => e.kind === 'uploadRejected')).not.toHaveProperty('filename');
  });

  it('refuses the upload when the scanner cannot answer (fail closed)', async () => {
    const store = storeWith(new RejectingScanner());
    await expect(store.scanUpload(upload('case-down', 'x'))).rejects.toBeInstanceOf(DocumentScannerUnavailableError);
    expect(events).toContainEqual(expect.objectContaining({ kind: 'scannerUnavailable', cause: 'disabled' }));
    expect((await db.select().from(documents).where(sql`owner_ref = 'case-down'`))).toHaveLength(0);
  });

  it('checks size and type before scanning', async () => {
    const scanner = new FakeScanner();
    const store = storeWith(scanner, { maxBytes: 10 });
    await expect(store.scanUpload(upload('case-003', Buffer.alloc(11)))).rejects.toBeInstanceOf(DocumentTooLargeError);
    await expect(store.scanUpload(upload('case-004', 'x', { filename: 'script.exe', mimeType: 'application/x-msdownload' }))).rejects.toBeInstanceOf(DocumentTypeNotAllowedError);
    expect(scanner.calls).toBe(0);
  });

  it('stores system content as system-generated without scanning it', async () => {
    const scanner = new FakeScanner();
    const store = storeWith(scanner);
    const stored = await store.adapter(db).store(store.systemContent(upload('award-1', 'rendered certificate'), 'award-document-render'));
    expect(stored.statusCode).toBe('system-generated');
    expect(scanner.calls).toBe(0);
    expect((await store.adapter(db).retrieve(TENANT_ID, stored.documentId, ACTOR_ID)).content.toString()).toBe('rendered certificate');
  });
});

describe('serving only what passed (ADR-030)', () => {
  it('refuses pending-scan and infected documents, and serves clean ones byte for byte', async () => {
    const store = storeWith(new FakeScanner());
    const content = Buffer.from('evidence content for retrieval test');
    const stored = await store.adapter(db).store(await store.scanUpload(upload('case-002', content)));
    const retrieved = await store.adapter(db).retrieve(TENANT_ID, stored.documentId, 'downloader-001');
    expect(retrieved.content.equals(content)).toBe(true);
    expect(await actions(stored.documentId)).toEqual(['retrieve', 'store']);

    await db.update(documents).set({ statusCode: 'pending-scan' }).where(sql`id = ${stored.documentId}`);
    await expect(store.adapter(db).retrieve(TENANT_ID, stored.documentId, 'downloader-001')).rejects.toMatchObject({ name: 'DocumentNotAvailableError', reason: 'pending-scan' });
    await db.update(documents).set({ statusCode: 'infected' }).where(sql`id = ${stored.documentId}`);
    await expect(store.adapter(db).retrieve(TENANT_ID, stored.documentId, 'downloader-001')).rejects.toBeInstanceOf(DocumentNotAvailableError);
    expect(events.filter((e) => e.kind === 'retrievalRefused').map((e) => e['reason'])).toEqual(['pending-scan', 'infected']);
    expect(await actions(stored.documentId)).toEqual(['retrieve', 'store']); // refusals are log events, not access-log rows
  });

  it('lists an owner\'s documents without infected or deleted ones', async () => {
    const store = storeWith(new FakeScanner());
    const a = await store.adapter(db).store(await store.scanUpload(upload('case-006', 'a')));
    const b = await store.adapter(db).store(await store.scanUpload(upload('case-006', 'b')));
    const c = await store.adapter(db).store(await store.scanUpload(upload('case-006', 'c')));
    await store.scanUpload(upload('case-006', 'EICAR')).catch(() => undefined);
    await store.adapter(db).softDelete(TENANT_ID, c.documentId, ACTOR_ID, 'test cleanup');
    const listed = await store.adapter(db).listByOwner(TENANT_ID, 'wellbeing', 'case-006');
    expect(listed.map((d) => d.documentId).sort()).toEqual([a.documentId, b.documentId].sort());
  });

  it('soft-deletes: content is gone, metadata and access log survive', async () => {
    const store = storeWith(new NoopScanner());
    const stored = await store.adapter(db).store(await store.scanUpload(upload('case-005', 'will be deleted')));
    await store.adapter(db).softDelete(TENANT_ID, stored.documentId, 'deleter-001', 'retention period expired');
    await expect(store.adapter(db).retrieve(TENANT_ID, stored.documentId, ACTOR_ID)).rejects.toBeInstanceOf(DocumentNotFoundError);
    expect((await store.adapter(db).getMetadata(TENANT_ID, stored.documentId)).deletedAt).not.toBeNull();
    expect(await actions(stored.documentId)).toEqual(['delete', 'store']);
  });

  it('scopes retrieval to the correct tenant', async () => {
    const store = storeWith(new NoopScanner());
    const stored = await store.adapter(db).store(await store.scanUpload(upload('case-007', 'x')));
    await expect(store.adapter(db).retrieve('00000000-0000-0000-0000-000000000099', stored.documentId, ACTOR_ID)).rejects.toBeInstanceOf(DocumentNotFoundError);
  });
});

describe('rescanning documents stored before scanning (ADR-030 item 11)', () => {
  it('turns pending rows clean or infected, dropping infected content, and is idempotent', async () => {
    const store = storeWith(new NoopScanner());
    const clean = await store.adapter(db).store(await store.scanUpload(upload('legacy', 'old letter')));
    const bad = await store.adapter(db).store(await store.scanUpload(upload('legacy', 'old EICAR attachment')));
    await db.update(documents).set({ statusCode: 'pending-scan', scannedAt: null }).where(sql`owner_ref = 'legacy'`);

    const rescanner = storeWith(new FakeScanner());
    expect(await rescanner.rescanPending(TENANT_ID, { ownerServices: ['wellbeing'] })).toEqual({ checked: 2, clean: 1, infected: 1, failed: 0 });
    const rows = Object.fromEntries((await db.select().from(documents).where(sql`owner_ref = 'legacy'`)).map((r) => [r.id, r]));
    expect(rows[clean.documentId]).toMatchObject({ statusCode: 'clean', scanEngine: 'fake' });
    expect(rows[bad.documentId]).toMatchObject({ statusCode: 'infected', content: null, scanSignature: 'Eicar-Test-Signature' });
    expect(events).toContainEqual(expect.objectContaining({ kind: 'rescanInfected', documentId: bad.documentId }));
    expect(await rescanner.rescanPending(TENANT_ID, { ownerServices: ['wellbeing'] })).toEqual({ checked: 0, clean: 0, infected: 0, failed: 0 });
  });

  it('leaves a document pending, and reports it, when the scanner cannot answer', async () => {
    const store = storeWith(new NoopScanner());
    const doc = await store.adapter(db).store(await store.scanUpload(upload('legacy-down', 'old')));
    await db.update(documents).set({ statusCode: 'pending-scan' }).where(sql`id = ${doc.documentId}`);
    const summary = await storeWith(new RejectingScanner()).rescanPending(TENANT_ID, { ownerServices: ['wellbeing'] });
    expect(summary.failed).toBeGreaterThanOrEqual(1);
    const [row] = await db.select().from(documents).where(sql`id = ${doc.documentId}`);
    expect(row!.statusCode).toBe('pending-scan');
  });
});
