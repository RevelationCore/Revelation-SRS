import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Spinner, Problem, EmptyState, formatDate } from '@revelation-srs/ui';
import { useAuth } from '../auth/AuthContext.js';
import { getNotifications, markNotificationRead, type NotificationItem } from '../api/notifications.js';

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000';

export function NotificationsPage() {
  const { t }     = useTranslation();
  const { token } = useAuth();

  const [items,   setItems]   = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Initial load
  useEffect(() => {
    void (async () => {
      try {
        const data = await getNotifications({ limit: 50 });
        setItems(data);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load notifications');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // SSE stream — prepend live events, deduplicate by id
  useEffect(() => {
    if (!token) return;

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    void (async () => {
      try {
        const resp = await fetch(`${API_BASE}/api/v1/notifications/stream`, {
          headers:  { Authorization: `Bearer ${token}` },
          signal:   ctrl.signal,
        });

        if (!resp.ok || !resp.body) return;

        const reader  = resp.body.getReader();
        const decoder = new TextDecoder();
        let   buffer  = '';

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          let eventName = '';
          for (const line of lines) {
            if (line.startsWith('event: ')) {
              eventName = line.slice(7).trim();
            } else if (line.startsWith('data: ') && eventName === 'notification') {
              try {
                const item = JSON.parse(line.slice(6)) as NotificationItem;
                setItems(prev => [item, ...prev.filter(p => p.id !== item.id)]);
              } catch { /* malformed JSON — skip */ }
              eventName = '';
            }
          }
        }
      } catch (e) {
        if ((e as Error).name !== 'AbortError') {
          // Stream closed or network error — silently ignore (non-critical)
        }
      }
    })();

    return () => {
      ctrl.abort();
      abortRef.current = null;
    };
  }, [token]);

  const handleMarkRead = useCallback(async (id: string) => {
    try {
      await markNotificationRead(id);
      setItems(prev => prev.map(n =>
        n.id === id ? { ...n, readAt: new Date().toISOString() } : n,
      ));
    } catch { /* ignore — UI will still show it as unread */ }
  }, []);

  const unreadCount = items.filter(n => n.readAt === null).length;

  if (loading) {
    return <div className="flex justify-center py-16"><Spinner size="lg" label={t('status.loading')} /></div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t('portal.nav.notifications')}</h1>
          <p className="mt-1 text-sm text-gray-500">Alerts and messages from the university</p>
        </div>
        {unreadCount > 0 && (
          <span className="rounded-full bg-indigo-600 px-2.5 py-0.5 text-xs font-semibold text-white">
            {unreadCount} unread
          </span>
        )}
      </div>

      {error && <Problem title={t('status.error')} detail={error} />}

      {!error && items.length === 0 && (
        <EmptyState title={t('portal.notifications.empty')} />
      )}

      {items.length > 0 && (
        <ul className="space-y-3" aria-label="Notifications">
          {items.map(item => (
            <li
              key={item.id}
              className={`rounded-lg border p-4 ${
                item.readAt === null
                  ? 'border-indigo-200 bg-indigo-50'
                  : 'border-gray-200 bg-white'
              }`}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className={`text-sm font-medium ${item.readAt === null ? 'text-indigo-900' : 'text-gray-900'}`}>
                    {item.title}
                  </p>
                  <p className="mt-0.5 text-sm text-gray-600">{item.body}</p>
                  {item.linkUrl && (
                    <a
                      href={item.linkUrl}
                      className="mt-1 inline-block text-xs text-indigo-600 hover:underline"
                    >
                      View details →
                    </a>
                  )}
                  <p className="mt-1 text-xs text-gray-400">{formatDate(item.createdAt)}</p>
                </div>
                {item.readAt === null && (
                  <button
                    onClick={() => void handleMarkRead(item.id)}
                    className="flex-none rounded border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50 whitespace-nowrap"
                    aria-label={`Mark "${item.title}" as read`}
                  >
                    Mark read
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
