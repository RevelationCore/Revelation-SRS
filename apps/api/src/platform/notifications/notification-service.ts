import { randomUUID } from 'node:crypto';

import { and, desc, eq, isNull } from 'drizzle-orm';
import { notifications, type Db } from '@revelation-srs/db';

import { clockNow } from '../clock.js';

export interface NotificationPayload {
  category: string;
  title:    string;
  body:     string;
  linkUrl?: string;
}

export interface NotificationRow {
  id:        string;
  personId:  string;
  category:  string;
  title:     string;
  body:      string;
  linkUrl:   string | null;
  readAt:    string | null;
  createdAt: string;
}

export interface SseConnection {
  tenantId: string;
  personId: string;
  send:     (event: string, data: string) => void;
  close:    () => void;
}

export class NotificationService {
  private readonly connections = new Map<string, SseConnection>();

  constructor(private readonly db: Db) {}

  // ─── SSE connection registry ───────────────────────────────────────────────

  addConnection(connectionId: string, conn: SseConnection): void {
    this.connections.set(connectionId, conn);
  }

  removeConnection(connectionId: string): void {
    this.connections.delete(connectionId);
  }

  // ─── Deliver to person (persist + push via SSE if connected) ──────────────

  async deliver(tenantId: string, payload: NotificationPayload & { personId: string }): Promise<NotificationRow> {
    const id = randomUUID();
    const now = clockNow();

    await this.db.insert(notifications).values({
      id,
      tenantId,
      personId:  payload.personId,
      category:  payload.category,
      title:     payload.title,
      body:      payload.body,
      linkUrl:   payload.linkUrl ?? null,
      createdAt: now,
    });

    const row: NotificationRow = {
      id,
      personId:  payload.personId,
      category:  payload.category,
      title:     payload.title,
      body:      payload.body,
      linkUrl:   payload.linkUrl ?? null,
      readAt:    null,
      createdAt: now.toISOString(),
    };

    this.pushToConnections(tenantId, payload.personId, row);
    return row;
  }

  // ─── Query ─────────────────────────────────────────────────────────────────

  async list(tenantId: string, personId: string, opts: { limit?: number; unreadOnly?: boolean } = {}): Promise<NotificationRow[]> {
    const { limit = 50, unreadOnly = false } = opts;

    const conditions = [
      eq(notifications.tenantId, tenantId),
      eq(notifications.personId, personId),
    ];
    if (unreadOnly) conditions.push(isNull(notifications.readAt));

    const rows = await this.db
      .select()
      .from(notifications)
      .where(and(...conditions))
      .orderBy(desc(notifications.createdAt))
      .limit(limit);

    return rows.map(toRow);
  }

  async markRead(tenantId: string, personId: string, notificationId: string): Promise<boolean> {
    const result = await this.db
      .update(notifications)
      .set({ readAt: clockNow() })
      .where(and(
        eq(notifications.id, notificationId),
        eq(notifications.tenantId, tenantId),
        eq(notifications.personId, personId),
        isNull(notifications.readAt),
      ))
      .returning({ id: notifications.id });

    return result.length > 0;
  }

  // ─── SSE fan-out ───────────────────────────────────────────────────────────

  private pushToConnections(tenantId: string, personId: string, row: NotificationRow): void {
    for (const conn of this.connections.values()) {
      if (conn.tenantId === tenantId && conn.personId === personId) {
        conn.send('notification', JSON.stringify(row));
      }
    }
  }
}

function toRow(r: typeof notifications.$inferSelect): NotificationRow {
  return {
    id:        r.id,
    personId:  r.personId,
    category:  r.category,
    title:     r.title,
    body:      r.body,
    linkUrl:   r.linkUrl ?? null,
    readAt:    r.readAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
  };
}
