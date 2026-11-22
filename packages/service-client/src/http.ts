/**
 * Every outbound HTTP call is time-bounded (BL-011, readiness 2.3, pattern
 * P-09). A call with no timeout lets one slow dependency hold a request, or
 * a worker, indefinitely. Services call fetchWithTimeout, never bare fetch;
 * a lint rule enforces it.
 */

/** Default limit for an outbound call: generous for a healthy dependency, short enough to fail fast. */
export const DEFAULT_OUTBOUND_TIMEOUT_MS = 10_000;

/**
 * fetch with a timeout. The timeout is combined with any signal the caller
 * passes, so either can abort the call; on timeout the promise rejects with
 * a DOMException named 'TimeoutError'.
 */
export function fetchWithTimeout(
  input:     string | URL,
  init:      RequestInit = {},
  timeoutMs: number = DEFAULT_OUTBOUND_TIMEOUT_MS,
): Promise<Response> {
  const timeout = AbortSignal.timeout(timeoutMs);
  const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
  // eslint-disable-next-line no-restricted-globals -- the one sanctioned use
  return fetch(input, { ...init, signal });
}
