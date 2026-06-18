import { useEffect, useState } from 'react';

const DEMO_MODE    = import.meta.env.VITE_DEMO_MODE === 'true';
const DISMISSED_KEY = 'srs_demo_banner_dismissed';

interface DemoStatus {
  active:        boolean;
  scenarioName:  string | null;
  demoNow:       string | null;
  nextResetAt:   string | null;
}

export function DemoBanner() {
  const [status, setStatus]     = useState<DemoStatus | null>(null);
  const [dismissed, setDismissed] = useState(
    () => sessionStorage.getItem(DISMISSED_KEY) === '1',
  );

  useEffect(() => {
    if (!DEMO_MODE || dismissed) return;
    const baseUrl = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000';
    fetch(`${baseUrl}/api/v1/demo/status`)
      .then(r => r.json() as Promise<DemoStatus>)
      .then(data => setStatus(data))
      .catch(() => { /* banner is non-critical — ignore failures */ });
  }, [dismissed]);

  if (!DEMO_MODE || dismissed || !status?.active) return null;

  function handleDismiss() {
    sessionStorage.setItem(DISMISSED_KEY, '1');
    setDismissed(true);
  }

  const demoDate = status.demoNow
    ? new Date(status.demoNow).toLocaleDateString('en-GB', {
        day: 'numeric', month: 'long', year: 'numeric',
      })
    : null;

  const nextReset = status.nextResetAt
    ? new Date(status.nextResetAt).toLocaleString('en-GB', {
        day: 'numeric', month: 'short',
        hour: '2-digit', minute: '2-digit', timeZoneName: 'short',
      })
    : null;

  return (
    <aside
      aria-label="Demo environment notice"
      className="border-b border-amber-300 bg-amber-50 px-6 py-2 text-sm text-amber-800"
    >
      <div className="mx-auto max-w-6xl flex items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <span className="rounded bg-amber-200 px-1.5 py-0.5 text-xs font-semibold uppercase tracking-wide text-amber-900">
            Demo
          </span>
          {status.scenarioName && (
            <span className="font-medium">{status.scenarioName}</span>
          )}
          {demoDate && (
            <span className="text-amber-700">Demo date: {demoDate}</span>
          )}
          {nextReset
            ? <span className="text-amber-700">Resets: {nextReset}</span>
            : <span className="text-amber-700">Data resets every 24&nbsp;hours</span>
          }
        </div>
        <button
          type="button"
          aria-label="Dismiss demo notice"
          onClick={handleDismiss}
          className="shrink-0 rounded p-1 text-amber-700 hover:bg-amber-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-amber-600"
        >
          <span aria-hidden="true">✕</span>
        </button>
      </div>
    </aside>
  );
}
