import { useCallback, useState } from 'react';

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
      setSubmitError(e instanceof Error ? e.message : 'An error occurred.');
      return undefined;
    } finally {
      setSubmitting(false);
    }
  }, [submitting]);

  const clearError = useCallback(() => setSubmitError(null), []);

  return { submitting, submitError, submit, clearError };
}
