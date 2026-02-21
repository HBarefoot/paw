import { describe, expect, test } from "bun:test";
import { RateLimiter } from "../../src/security/rate-limiter.js";

describe("rate limiter", () => {
	test("allows requests under the limit", () => {
		const limiter = new RateLimiter(5);
		for (let i = 0; i < 5; i++) {
			const { allowed } = limiter.check("user1");
			expect(allowed).toBe(true);
		}
	});

	test("blocks requests over the limit", () => {
		const limiter = new RateLimiter(3);
		limiter.check("user1");
		limiter.check("user1");
		limiter.check("user1");
		const { allowed, retryAfterMs } = limiter.check("user1");
		expect(allowed).toBe(false);
		expect(retryAfterMs).toBeGreaterThan(0);
	});

	test("tracks users independently", () => {
		const limiter = new RateLimiter(2);
		limiter.check("user1");
		limiter.check("user1");
		const { allowed: user1 } = limiter.check("user1");
		const { allowed: user2 } = limiter.check("user2");
		expect(user1).toBe(false);
		expect(user2).toBe(true);
	});

	test("reset clears user's history", () => {
		const limiter = new RateLimiter(2);
		limiter.check("user1");
		limiter.check("user1");
		expect(limiter.check("user1").allowed).toBe(false);
		limiter.reset("user1");
		expect(limiter.check("user1").allowed).toBe(true);
	});
});
