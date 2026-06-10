import type { Logger } from "../types/plugin.js";

/**
 * Retry a function with exponential backoff on rate-limit or transient errors.
 * Retries on HTTP 429, 502, 503, 529 or network errors.
 *
 * H-NEW-5: when a `signal` is provided, the retry loop respects
 * cancellation. Aborting immediately throws and skips remaining attempts.
 *
 * M-NEW-7: retry delays include ±20% jitter to avoid dog-pile retries
 * from parallel agents.
 */
export async function withRetry<T>(
	fn: () => Promise<T>,
	logger: Logger,
	maxRetriesOrOpts: number | { maxRetries?: number; signal?: AbortSignal } = 3,
): Promise<T> {
	const opts =
		typeof maxRetriesOrOpts === "number"
			? { maxRetries: maxRetriesOrOpts }
			: maxRetriesOrOpts;
	const maxRetries = opts.maxRetries ?? 3;
	const signal = opts.signal;

	let lastError: unknown;
	for (let attempt = 0; attempt <= maxRetries; attempt++) {
		// Honor cancellation before each attempt.
		if (signal?.aborted) {
			throw new Error("Aborted");
		}
		try {
			return await fn();
		} catch (err: unknown) {
			// Don't retry if the caller cancelled.
			if (signal?.aborted) throw err;
			lastError = err;
			const msg = err instanceof Error ? err.message : String(err);
			const isRetryable =
				msg.includes("429") ||
				msg.includes("500") ||
				msg.includes("502") ||
				msg.includes("503") ||
				msg.includes("529") ||
				msg.includes("rate_limit") ||
				msg.includes("ETIMEDOUT") ||
				msg.includes("ECONNRESET") ||
				msg.includes("TimeoutError") ||
				msg.includes("AbortError");
			if (!isRetryable || attempt === maxRetries) throw err;
			// Exponential backoff with ±20% jitter (M-NEW-7).
			const baseDelay = Math.min(1000 * Math.pow(2, attempt), 30_000);
			const jitter = baseDelay * 0.2 * (Math.random() * 2 - 1);
			const delayMs = Math.max(0, Math.floor(baseDelay + jitter));
			logger.warn("Retrying after transient error", {
				attempt: attempt + 1,
				delayMs,
				error: msg,
			});
			await new Promise((resolve, reject) => {
				const t = setTimeout(resolve, delayMs);
				if (signal) {
					const onAbort = () => {
						clearTimeout(t);
						reject(new Error("Aborted"));
					};
					signal.addEventListener("abort", onAbort, { once: true });
				}
			});
		}
	}
	throw lastError;
}
