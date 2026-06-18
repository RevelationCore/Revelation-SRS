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

export function createNotificationStream(token: string, baseUrl: string): EventSource {
  const url = `${baseUrl}/api/v1/notifications/stream`;
  return new EventSource(`${url}?token=${encodeURIComponent(token)}`);
}
