import { useEffect, useState } from 'react';

import { ApiError } from '../api/client.js';

interface ApiDataState<T> {
  data:    T | null;
  loading: boolean;
  error:   string | null;
}

/**
 * Fetches data from a parameterised API call.
 * Re-runs whenever `fetch` identity changes, so callers should memoize or
 * keep the function stable (e.g. pass an arrow function bound to constant args).
 *
 * Pass `null` as `fetch` to skip the request (e.g. while personId is loading).
 */
export function useApiData<T>(
  fetch: (() => Promise<T>) | null,
): ApiDataState<T> {
  const [data,    setData]    = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);

  useEffect(() => {
    if (!fetch) return;
    let cancelled = false;

    setLoading(true);
    setError(null);

    fetch()
      .then((result) => { if (!cancelled) { setData(result); setLoading(false); } })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof ApiError ? (e.detail ?? e.message) : 'Failed to load data.');
        setLoading(false);
      });

    return () => { cancelled = true; };
  }, [fetch]);

  return { data, loading, error };
}
