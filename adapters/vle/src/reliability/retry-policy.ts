export interface RetryOptions {
  maxAttempts:    number;
  initialDelayMs: number;
  backoffFactor:  number;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function withRetry<T>(
  fn:   () => Promise<T>,
  opts: RetryOptions,
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < opts.maxAttempts) {
        const delay = opts.initialDelayMs * Math.pow(opts.backoffFactor, attempt - 1);
        await sleep(delay);
      }
    }
  }

  throw lastError;
}
