import { describe, expect, test } from "bun:test";
import {
	type FallbackAttempt,
	withProviderFallback,
} from "../../src/ai/router.js";
import { isTransientError } from "../../src/ai/retry.js";

function attempt(
	name: string,
	run: () => Promise<string>,
): FallbackAttempt<string> {
	return { providerName: name, model: `${name}-model`, run };
}

describe("isTransientError", () => {
	test("classifies retryable provider failures as transient", () => {
		for (const msg of [
			"429 Too Many Requests",
			"rate_limit exceeded",
			"503 Service Unavailable",
			"ETIMEDOUT",
			"ECONNRESET",
		]) {
			expect(isTransientError(new Error(msg))).toBe(true);
		}
	});

	test("does NOT classify user refusals / tool errors / 4xx auth as transient", () => {
		for (const msg of [
			"The assistant refused to answer",
			"tool execution failed: file not found",
			"400 invalid_request_error",
			"401 unauthorized",
		]) {
			expect(isTransientError(new Error(msg))).toBe(false);
		}
	});
});

describe("withProviderFallback", () => {
	test("primary succeeds → no fallback, tagged as primary", async () => {
		const fb = attempt("openai", async () => {
			throw new Error("should not be called");
		});
		const r = await withProviderFallback({
			primary: attempt("claude", async () => "primary-ok"),
			fallbacks: [fb],
		});
		expect(r.value).toBe("primary-ok");
		expect(r.usedFallback).toBe(false);
		expect(r.used.providerName).toBe("claude");
	});

	test("primary transient error → fallback serves the turn, tagged as fallback", async () => {
		const r = await withProviderFallback({
			primary: attempt("ollama", async () => {
				throw new Error("503 Service Unavailable");
			}),
			fallbacks: [attempt("claude", async () => "fallback-ok")],
		});
		expect(r.value).toBe("fallback-ok");
		expect(r.usedFallback).toBe(true);
		expect(r.used.providerName).toBe("claude");
		expect(r.used.model).toBe("claude-model");
	});

	test("non-transient primary error → rethrown immediately, fallback never runs", async () => {
		let fallbackRan = false;
		await expect(
			withProviderFallback({
				primary: attempt("ollama", async () => {
					throw new Error("400 invalid_request");
				}),
				fallbacks: [
					attempt("claude", async () => {
						fallbackRan = true;
						return "nope";
					}),
				],
			}),
		).rejects.toThrow("400 invalid_request");
		expect(fallbackRan).toBe(false);
	});

	test("all attempts fail transiently → last error propagates (message not dropped)", async () => {
		await expect(
			withProviderFallback({
				primary: attempt("ollama", async () => {
					throw new Error("503 first");
				}),
				fallbacks: [
					attempt("openai", async () => {
						throw new Error("429 last");
					}),
				],
			}),
		).rejects.toThrow("429 last");
	});

	test("aborted signal → no fallback even on a transient error", async () => {
		let fallbackRan = false;
		const ac = new AbortController();
		ac.abort();
		await expect(
			withProviderFallback({
				primary: attempt("ollama", async () => {
					throw new Error("503 Service Unavailable");
				}),
				fallbacks: [
					attempt("claude", async () => {
						fallbackRan = true;
						return "nope";
					}),
				],
				signal: ac.signal,
			}),
		).rejects.toThrow();
		expect(fallbackRan).toBe(false);
	});

	test("empty fallback list → behaves like a bare primary call", async () => {
		const ok = await withProviderFallback({
			primary: attempt("claude", async () => "only-primary"),
			fallbacks: [],
		});
		expect(ok.value).toBe("only-primary");
		expect(ok.usedFallback).toBe(false);

		await expect(
			withProviderFallback({
				primary: attempt("claude", async () => {
					throw new Error("503 down");
				}),
				fallbacks: [],
			}),
		).rejects.toThrow("503 down");
	});
});
