import { api } from './client.js';

export interface NotificationItem {
  id:        string;
  personId:  string;
  category:  string;
  title:     string;
  body:      string;
  linkUrl:   string | null;
  readAt:    string | null;
  createdAt: string;
}

export function getNotifications(opts?: { limit?: number; unreadOnly?: boolean }): Promise<NotificationItem[]> {
  const params = new URLSearchParams();
  if (opts?.limit !== undefined)      params.set('limit',      String(opts.limit));
  if (opts?.unreadOnly !== undefined) params.set('unreadOnly', String(opts.unreadOnly));
  const qs = params.toString() ? `?${params.toString()}` : '';
  return api.get(`/api/v1/notifications${qs}`);
}

export function markNotificationRead(id: string): Promise<void> {
  return api.patch(`/api/v1/notifications/${id}/read`, {});
}

/** The live stream, authenticated by the BFF session cookie (ADR-026 item 12). */
export function createNotificationStream(): EventSource {
  return new EventSource('/bff/srs/api/v1/notifications/stream', { withCredentials: true });
}
