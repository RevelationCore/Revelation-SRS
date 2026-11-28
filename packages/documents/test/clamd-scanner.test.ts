/**
 * ADR-030 guard: ClamdScanner against a fake clamd (an in-process TCP server
 * speaking INSTREAM): verdicts, framing, errors, timeout, retry, concurrency.
 */
import { createServer, type Server, type Socket } from 'node:net';
import type { AddressInfo } from 'node:net';

import { afterEach, describe, expect, it } from 'vitest';

import { ClamdScanner, DocumentScannerUnavailableError } from '../src/index.js';

type Behaviour = (socket: Socket, stream: Buffer, command: string) => void;

interface Fake { server: Server; port: number; received: Buffer[]; open: number; maxOpen: number; connections: number }

const fakes: Fake[] = [];
afterEach(async () => {
  await Promise.all(fakes.splice(0).map((f) => new Promise<void>((r) => f.server.close(() => r()))));
});

/** A fake clamd: parses zINSTREAM framing, answers zVERSION, then calls `behaviour`. */
async function fakeClamd(behaviour: Behaviour): Promise<Fake> {
  const fake: Fake = { server: createServer(), port: 0, received: [], open: 0, maxOpen: 0, connections: 0 };
  fake.server.on('connection', (socket) => {
    fake.connections++; fake.open++; fake.maxOpen = Math.max(fake.maxOpen, fake.open);
    socket.on('close', () => { fake.open--; });
    let buf = Buffer.alloc(0);
    socket.on('data', (d: Buffer) => {
      buf = Buffer.concat([buf, d]);
      if (buf.toString('latin1').startsWith('zVERSION\0')) { socket.end('ClamAV 1.5.1/27500/Sun Nov 22 08:00:00 2026\0'); return; }
      const head = 'zINSTREAM\0';
      if (!buf.toString('latin1').startsWith(head)) return;
      let off = head.length;
      const parts: Buffer[] = [];
      for (;;) {
        if (buf.length < off + 4) return;
        const len = buf.readUInt32BE(off);
        if (len === 0) break;
        if (buf.length < off + 4 + len) return;
        parts.push(buf.subarray(off + 4, off + 4 + len));
        off += 4 + len;
      }
      const stream = Buffer.concat(parts);
      fake.received.push(stream);
      behaviour(socket, stream, 'INSTREAM');
    });
  });
  await new Promise<void>((r) => fake.server.listen(0, '127.0.0.1', () => r()));
  fake.port = (fake.server.address() as AddressInfo).port;
  fakes.push(fake);
  return fake;
}

const scanner = (port: number, opts: { timeoutMs?: number; maxConcurrency?: number } = {}) => new ClamdScanner({ host: '127.0.0.1', port, ...opts });
const signal = () => AbortSignal.timeout(10_000);

describe('ClamdScanner', () => {
  it('reads OK as clean, with the signature database version', async () => {
    const f = await fakeClamd((s) => s.end('stream: OK\0'));
    const v = await scanner(f.port).scan(Buffer.from('hello'), signal());
    expect(v).toEqual({ verdict: 'clean', engine: 'clamav', databaseVersion: 'ClamAV 1.5.1/27500/Sun Nov 22 08:00:00 2026' });
  });

  it('reads FOUND as infected with the signature name', async () => {
    const f = await fakeClamd((s) => s.end('stream: Eicar-Test-Signature FOUND\0'));
    const v = await scanner(f.port).scan(Buffer.from('X5O!P%@AP'), signal());
    expect(v).toMatchObject({ verdict: 'infected', signature: 'Eicar-Test-Signature' });
  });

  it('frames the content in chunks and ends with a zero-length chunk', async () => {
    const f = await fakeClamd((s) => s.end('stream: OK\0'));
    const content = Buffer.alloc(200_000, 7); // more than three 64 KiB chunks
    await scanner(f.port).scan(content, signal());
    expect(f.received[0]!.equals(content)).toBe(true);
  });

  it('treats ERROR and size-limit replies as protocol failures, never as clean', async () => {
    for (const reply of ['INSTREAM size limit exceeded. ERROR\0', 'stream: Can\'t allocate memory ERROR\0', 'something odd\0']) {
      const f = await fakeClamd((s) => s.end(reply));
      await expect(scanner(f.port).scan(Buffer.from('x'), signal())).rejects.toMatchObject({ name: 'DocumentScannerUnavailableError', cause: 'protocol' });
    }
  });

  it('gives up within the time budget when clamd does not answer', async () => {
    const f = await fakeClamd(() => { /* never answers */ });
    const started = Date.now();
    await expect(scanner(f.port, { timeoutMs: 300 }).scan(Buffer.from('x'), signal())).rejects.toMatchObject({ cause: 'timeout' });
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it('retries a refused connection once, then reports connection', async () => {
    const f = await fakeClamd((s) => s.end('stream: OK\0'));
    const port = f.port;
    await new Promise<void>((r) => f.server.close(() => r()));
    fakes.splice(fakes.indexOf(f), 1);
    const err = await scanner(port).scan(Buffer.from('x'), signal()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DocumentScannerUnavailableError);
    expect((err as DocumentScannerUnavailableError).cause).toBe('connection');
  });

  it('never has more than maxConcurrency scans open at once', async () => {
    // Scans in flight as clamd sees them: from a complete stream to its reply.
    let inFlight = 0;
    let maxInFlight = 0;
    const f = await fakeClamd((sock) => {
      inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
      setTimeout(() => { inFlight--; sock.end('stream: OK\0'); }, 50);
    });
    const s = scanner(f.port, { maxConcurrency: 2 });
    await Promise.all(Array.from({ length: 6 }, () => s.scan(Buffer.from('x'), signal())));
    expect(maxInFlight).toBe(2);
    expect(f.received).toHaveLength(6);
  });
});
