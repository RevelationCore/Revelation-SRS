import { useCallback, useState } from 'react';

import { ApiError } from '../api/client.js';

export interface FormSubmitState {
  submitting:  boolean;
  submitError: string | null;
  clearError:  () => void;
}

export type SubmitFn<T = unknown> = (fn: () => Promise<T>) => Promise<T | undefined>;

export function useFormSubmit<T = unknown>(): FormSubmitState & { submit: SubmitFn<T> } {
  const [submitting,  setSubmitting]  = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const submit = useCallback(async (fn: () => Promise<T>): Promise<T | undefined> => {
    if (submitting) return undefined;
    setSubmitting(true);
    setSubmitError(null);
    try {
      return await fn();
    } catch (e) {
      // Prefer the RFC 7807 `detail` (specific, actionable) over `title`
      // (generic category, mapped to Error#message by the API client) —
      // matching how every other error handler in this codebase surfaces
      // ApiError, so a form doesn't show "Conflict" when the API already
      // said exactly what conflicted.
      setSubmitError(e instanceof ApiError ? (e.detail ?? e.message) : e instanceof Error ? e.message : 'An error occurred.');
      return undefined;
    } finally {
      setSubmitting(false);
    }
  }, [submitting]);

  const clearError = useCallback(() => setSubmitError(null), []);

  return { submitting, submitError, submit, clearError };
}
