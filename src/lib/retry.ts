import { RETRY_MAX_ATTEMPTS, RETRY_BASE_DELAY_MS, RETRY_MAX_DELAY_MS } from "./constants";

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: {
    shouldRetry: (error: unknown) => boolean;
    maxAttempts?: number;
    baseDelayMs?: number;
    maxDelayMs?: number;
  },
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? RETRY_MAX_ATTEMPTS;
  if (maxAttempts < 1) throw new Error("maxAttempts must be >= 1");
  const baseDelayMs = options.baseDelayMs ?? RETRY_BASE_DELAY_MS;
  const maxDelayMs = options.maxDelayMs ?? RETRY_MAX_DELAY_MS;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt + 1 >= maxAttempts || !options.shouldRetry(error)) {
        throw error;
      }

      const exponentialDelay = baseDelayMs * Math.pow(2, attempt);
      const clampedDelay = Math.min(exponentialDelay, maxDelayMs);
      const jitter = clampedDelay * (0.75 + Math.random() * 0.5);
      await new Promise((resolve) => setTimeout(resolve, jitter));
    }
  }

  // Unreachable: the loop always returns or throws. This satisfies TypeScript.
  throw new Error("withRetry: unexpected state");
}
