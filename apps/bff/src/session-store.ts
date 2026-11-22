import type postgres from 'postgres';

import type { BffConfig } from './config.js';
import { open, randomId, seal, sha256 } from './crypto.js';
import type { OidcClient, TokenSet } from './oidc.js';

/**
 * Sessions in Postgres (ADR-026 item 5): keyed by the SHA-256 of the cookie
 * value, tokens encrypted. Refresh happens under SELECT … FOR UPDATE, so
 * concurrent requests on any BFF pod make one refresh and a rotated refresh
 * token is never presented twice (item 6).
 */
export interface Session { idHash: string; sub: string; sid: string | null; tokens: TokenSet; idleExpiresAt: Date; absoluteExpiresAt: Date }

type Sql = postgres.Sql;
type Row = { id_hash: string; sub: string; sid: string | null; tokens: string; key_id: string; access_expires_at: Date; idle_expires_at: Date; absolute_expires_at: Date };

const now = () => new Date(); // clock:allow — session expiry is wall-clock

export class SessionStore {
  constructor(private readonly sql: Sql, private readonly cfg: BffConfig, private readonly oidc: OidcClient) {}

  /** Creates a session and returns the cookie value (never stored). */
  async create(tokens: TokenSet, sub: string, sid: string | null): Promise<string> {
    const cookie = randomId();
    const sealed = seal(this.cfg.sessionKeys, JSON.stringify(tokens));
    const t = now();
    await this.sql`
      INSERT INTO bff.session (id_hash, client_id, sub, sid, tokens, key_id, access_expires_at, idle_expires_at, absolute_expires_at)
      VALUES (${sha256(cookie)}, ${this.cfg.clientId}, ${sub}, ${sid}, ${sealed.value}, ${sealed.kid}, ${new Date(tokens.expiresAt)},
              ${new Date(t.getTime() + this.cfg.idleSeconds * 1000)}, ${new Date(t.getTime() + this.cfg.absoluteSeconds * 1000)})`;
    return cookie;
  }

  /** The live session for a cookie, extending its idle limit; null if none or expired. */
  async get(cookie: string | undefined): Promise<Session | null> {
    if (!cookie) return null;
    const t = now();
    const [row] = await this.sql<Row[]>`
      UPDATE bff.session SET last_seen_at = ${t}, idle_expires_at = LEAST(absolute_expires_at, ${new Date(t.getTime() + this.cfg.idleSeconds * 1000)})
      WHERE id_hash = ${sha256(cookie)} AND client_id = ${this.cfg.clientId} AND idle_expires_at > ${t} AND absolute_expires_at > ${t}
      RETURNING *`;
    return row ? this.#toSession(row) : null;
  }

  /**
   * The session with an access token valid for at least `minSeconds`,
   * refreshing under the row lock if needed (`force` after an upstream 401).
   * Null when the session has gone or the refresh was refused (then the
   * session is deleted).
   */
  async withFreshToken(cookie: string, minSeconds = 60, force = false): Promise<Session | null> {
    const idHash = sha256(cookie);
    return this.sql.begin(async (tx) => {
      const [row] = await tx<Row[]>`SELECT * FROM bff.session WHERE id_hash = ${idHash} AND client_id = ${this.cfg.clientId} FOR UPDATE`;
      if (!row || row.absolute_expires_at <= now() || row.idle_expires_at <= now()) return null;
      const session = this.#toSession(row);
      const fresh = session.tokens.expiresAt - Date.now() > minSeconds * 1000; // clock:allow
      // Another pod may have refreshed while this one waited on the lock: then the token is fresh.
      if (fresh && !force) return session;
      if (!session.tokens.refreshToken) {
        if (fresh) return session;
        await tx`DELETE FROM bff.session WHERE id_hash = ${idHash}`;
        return null;
      }
      let next: TokenSet;
      try {
        next = await this.oidc.refresh(session.tokens.refreshToken);
      } catch {
        await tx`DELETE FROM bff.session WHERE id_hash = ${idHash}`;
        return null;
      }
      const tokens: TokenSet = { ...next, idToken: next.idToken ?? session.tokens.idToken, refreshToken: next.refreshToken ?? session.tokens.refreshToken };
      const sealed = seal(this.cfg.sessionKeys, JSON.stringify(tokens));
      await tx`UPDATE bff.session SET tokens = ${sealed.value}, key_id = ${sealed.kid}, access_expires_at = ${new Date(tokens.expiresAt)} WHERE id_hash = ${idHash}`;
      return { ...session, tokens };
    });
  }

  async delete(cookie: string): Promise<Session | null> {
    const [row] = await this.sql<Row[]>`DELETE FROM bff.session WHERE id_hash = ${sha256(cookie)} AND client_id = ${this.cfg.clientId} RETURNING *`;
    return row ? this.#toSession(row) : null;
  }

  /** Back-channel logout: every session of this client with the Keycloak sid (or, failing that, the sub). */
  async deleteBySid(sid: string | undefined, sub: string | undefined): Promise<number> {
    const rows = sid
      ? await this.sql`DELETE FROM bff.session WHERE client_id = ${this.cfg.clientId} AND sid = ${sid} RETURNING id_hash`
      : await this.sql`DELETE FROM bff.session WHERE client_id = ${this.cfg.clientId} AND sub = ${sub ?? ''} RETURNING id_hash`;
    return rows.length;
  }

  /** Removes expired sessions; one pod at a time (advisory lock, ADR-027). */
  async sweep(): Promise<number> {
    return this.sql.begin(async (tx) => {
      const [{ locked }] = await tx<[{ locked: boolean }]>`SELECT pg_try_advisory_xact_lock(hashtext('bff.session.sweep')) AS locked`;
      if (!locked) return 0;
      const t = now();
      const rows = await tx`DELETE FROM bff.session WHERE idle_expires_at <= ${t} OR absolute_expires_at <= ${t} RETURNING id_hash`;
      return rows.length;
    });
  }

  #toSession(row: Row): Session {
    return {
      idHash: row.id_hash, sub: row.sub, sid: row.sid,
      tokens: JSON.parse(open(this.cfg.sessionKeys, row.key_id, row.tokens)) as TokenSet,
      idleExpiresAt: row.idle_expires_at, absoluteExpiresAt: row.absolute_expires_at,
    };
  }
}
