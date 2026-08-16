import { useEffect, useState } from 'react';

const DEMO_MODE    = import.meta.env.VITE_DEMO_MODE === 'true';
const LIMITATIONS_URL = import.meta.env.VITE_KNOWN_LIMITATIONS_URL ?? 'https://github.com/RevelationCore/Revelation-SRS/blob/main/docs/product/current-capabilities.md';

interface DemoStatus {
  active:        boolean;
  scenarioName:  string | null;
  scenarioSlug:  string | null;
  schemaVersion: string | null;
  demoNow:       string | null;
  nextResetAt:   string | null;
}

export function DemoBanner() {
  const [status, setStatus]     = useState<DemoStatus | null>(null);

  useEffect(() => {
    if (!DEMO_MODE) return;
    const baseUrl = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000';
    fetch(`${baseUrl}/api/v1/demo/status`)
      .then(r => r.json() as Promise<DemoStatus>)
      .then(data => setStatus(data))
      .catch(() => { /* banner is non-critical — ignore failures */ });
  }, []);

  if (!DEMO_MODE || !status?.active) return null;

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
      className="border-b border-warning-300 bg-warning-50 px-6 py-2 text-sm text-warning-800"
    >
      <div className="mx-auto max-w-6xl flex items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <span className="rounded bg-warning-200 px-1.5 py-0.5 text-xs font-semibold uppercase tracking-wide text-warning-900">
            Alpha demo
          </span>
          {status.scenarioName && (
            <span className="font-medium">{status.scenarioName}</span>
          )}
          {status.scenarioSlug && <span className="text-warning-700">Scenario: {status.scenarioSlug}</span>}
          {status.schemaVersion && <span className="text-warning-700">Data v{status.schemaVersion}</span>}
          {demoDate && (
            <span className="text-warning-700">Demo date: {demoDate}</span>
          )}
          {nextReset
            ? <span className="text-warning-700">Resets: {nextReset}</span>
            : <span className="text-warning-700">Data resets every 24&nbsp;hours</span>
          }
        </div>
        <a href={LIMITATIONS_URL} target="_blank" rel="noreferrer" className="shrink-0 font-medium underline">Known limitations</a>
      </div>
    </aside>
  );
}
