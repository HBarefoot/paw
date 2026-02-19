import type { Logger } from "../types/plugin.js";

/**
 * Retry a function with exponential backoff on rate-limit or transient errors.
 * Retries on HTTP 429, 502, 503, 529 or network errors.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  logger: Logger,
  maxRetries = 3,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      lastError = err;
      const msg = err instanceof Error ? err.message : String(err);
      const isRetryable =
        msg.includes("429") ||
        msg.includes("502") ||
        msg.includes("503") ||
        msg.includes("529") ||
        msg.includes("rate_limit") ||
        msg.includes("ETIMEDOUT") ||
        msg.includes("ECONNRESET");
      if (!isRetryable || attempt === maxRetries) throw err;
      const delayMs = Math.min(1000 * Math.pow(2, attempt), 30_000);
      logger.warn("Retrying after transient error", { attempt: attempt + 1, delayMs, error: msg });
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastError;
}
