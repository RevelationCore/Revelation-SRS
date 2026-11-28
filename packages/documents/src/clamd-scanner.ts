import { connect, type Socket } from 'node:net';

import { DocumentScannerUnavailableError, type DocumentScanner, type ScanVerdict } from './scanner.js';

/**
 * ClamAV clamd over TCP with INSTREAM (ADR-030 item 5). Content is sent in
 * 64 KiB chunks, each prefixed with its 4-byte big-endian length, ended by a
 * zero-length chunk; clamd answers `stream: OK`, `stream: <name> FOUND` or
 * an ERROR line. Bounded in time and concurrency (P-09).
 */
export interface ClamdScannerOptions {
  host:            string;
  port:            number;
  /** The whole scan, including any wait for a concurrency slot (default 30 s). */
  timeoutMs?:      number;
  /** Scans in flight per process (default 4); further scans wait. */
  maxConcurrency?: number;
  /** Connect limit (default 2 s). */
  connectTimeoutMs?: number;
}

const CHUNK = 64 * 1024;
const VERSION_TTL_MS = 5 * 60_000;

export class ClamdScanner implements DocumentScanner {
  readonly engine = 'clamav';
  readonly #timeoutMs: number;
  readonly #connectTimeoutMs: number;
  readonly #max: number;
  #active = 0;
  readonly #waiting: Array<() => void> = [];
  #version: { value: string | null; at: number } | null = null;

  constructor(private readonly opts: ClamdScannerOptions) {
    this.#timeoutMs = opts.timeoutMs ?? 30_000;
    this.#connectTimeoutMs = opts.connectTimeoutMs ?? 2_000;
    this.#max = opts.maxConcurrency ?? 4;
  }

  async scan(content: Buffer, signal: AbortSignal): Promise<ScanVerdict> {
    const deadline = AbortSignal.any([signal, AbortSignal.timeout(this.#timeoutMs)]);
    await this.#acquire(deadline);
    try {
      const reply = await this.#instreamWithRetry(content, deadline);
      const databaseVersion = await this.#databaseVersion(deadline).catch(() => null);
      const m = /^stream: (.+) FOUND$/.exec(reply);
      if (reply === 'stream: OK') return { verdict: 'clean', engine: this.engine, databaseVersion };
      if (m) return { verdict: 'infected', engine: this.engine, databaseVersion, signature: m[1]! };
      throw new DocumentScannerUnavailableError('protocol', reply.slice(0, 200));
    } finally {
      this.#release();
    }
  }

  async #acquire(signal: AbortSignal): Promise<void> {
    if (this.#active < this.#max) { this.#active++; return; }
    await new Promise<void>((resolve, reject) => {
      const onAbort = () => {
        const i = this.#waiting.indexOf(go);
        if (i >= 0) this.#waiting.splice(i, 1);
        reject(new DocumentScannerUnavailableError('timeout', 'waiting for a scan slot'));
      };
      const go = () => { signal.removeEventListener('abort', onAbort); this.#active++; resolve(); };
      if (signal.aborted) { onAbort(); return; }
      signal.addEventListener('abort', onAbort, { once: true });
      this.#waiting.push(go);
    });
  }

  #release(): void {
    this.#active--;
    this.#waiting.shift()?.();
  }

  /** One retry, only when the connection was refused or reset before any content was sent. */
  async #instreamWithRetry(content: Buffer, signal: AbortSignal): Promise<string> {
    try {
      return await this.#instream(content, signal);
    } catch (err) {
      if (err instanceof EarlyConnectionError) {
        try { return await this.#instream(content, signal); } catch (again) {
          if (again instanceof EarlyConnectionError) throw new DocumentScannerUnavailableError('connection', again.message);
          throw again;
        }
      }
      throw err;
    }
  }

  #instream(content: Buffer, signal: AbortSignal): Promise<string> {
    return this.#exchange(signal, (socket) => {
      socket.write(Buffer.from('zINSTREAM\0'));
      for (let i = 0; i < content.length; i += CHUNK) {
        const part = content.subarray(i, i + CHUNK);
        const len = Buffer.alloc(4);
        len.writeUInt32BE(part.length);
        socket.write(len);
        socket.write(part);
      }
      socket.write(Buffer.alloc(4)); // zero-length chunk ends the stream
    });
  }

  async #databaseVersion(signal: AbortSignal): Promise<string | null> {
    const now = Date.now(); // clock:allow — cache bookkeeping
    if (this.#version && now - this.#version.at < VERSION_TTL_MS) return this.#version.value;
    const reply = await this.#exchange(signal, (socket) => { socket.write(Buffer.from('zVERSION\0')); });
    this.#version = { value: reply || null, at: now };
    return this.#version.value;
  }

  /** Connect, send, and read one NUL- or newline-terminated reply. */
  #exchange(signal: AbortSignal, send: (socket: Socket) => void): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      let sent = false;
      let settled = false;
      const chunks: Buffer[] = [];
      const socket = connect({ host: this.opts.host, port: this.opts.port });
      const connectTimer = setTimeout(() => fail(new DocumentScannerUnavailableError('connection', 'connect timed out')), this.#connectTimeoutMs);
      const onAbort = () => fail(new DocumentScannerUnavailableError('timeout'));
      const fail = (err: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(connectTimer);
        signal.removeEventListener('abort', onAbort);
        socket.destroy();
        reject(err);
      };
      const done = () => {
        if (settled) return;
        settled = true;
        clearTimeout(connectTimer);
        signal.removeEventListener('abort', onAbort);
        socket.destroy();
        resolve(Buffer.concat(chunks).toString('utf8').replace(/[\0\n]+$/, '').trim());
      };
      if (signal.aborted) { onAbort(); return; }
      signal.addEventListener('abort', onAbort, { once: true });
      socket.on('connect', () => {
        clearTimeout(connectTimer);
        sent = true;
        send(socket);
      });
      socket.on('data', (d: Buffer) => {
        chunks.push(d);
        if (d.includes(0) || d.includes(10)) done();
      });
      socket.on('end', () => { if (chunks.length > 0) done(); else fail(new DocumentScannerUnavailableError('protocol', 'connection closed without a reply')); });
      socket.on('error', (err: NodeJS.ErrnoException) => {
        if (!sent && (err.code === 'ECONNREFUSED' || err.code === 'ECONNRESET')) fail(new EarlyConnectionError(err.code));
        else if (err.code === 'ECONNREFUSED' || err.code === 'ECONNRESET') fail(new DocumentScannerUnavailableError('connection', err.code));
        else fail(new DocumentScannerUnavailableError('connection', err.code ?? err.message));
      });
    });
  }
}

/** Refused or reset before any content was sent: safe to retry once (another replica behind the Service). */
class EarlyConnectionError extends Error {
  constructor(code: string) { super(code); this.name = 'EarlyConnectionError'; }
}
