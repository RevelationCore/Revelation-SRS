import type { ReactNode } from 'react';

export function StatusNotice({ children }: { children: ReactNode }) {
  return <div role="status" aria-live="polite" className="mb-4 rounded-md border border-success-300 bg-success-50 px-4 py-3 text-sm text-success-800">{children}</div>;
}
