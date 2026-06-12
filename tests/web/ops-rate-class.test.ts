import { describe, expect, test } from "bun:test";
import { resolveRateClass } from "../../src/web/rate-limit-policy.js";

// Rider 2: the ops feed is polled ~2s like its siblings and MUST be classified
// `live` (600/min), not default `action` (60/min) which would 429 the poller.
describe("ops feed rate class", () => {
	test("GET /api/ops/feed → live", () => {
		expect(resolveRateClass("GET", "/api/ops/feed")).toBe("live");
	});

	test("sits alongside the other live pollers", () => {
		expect(resolveRateClass("GET", "/api/agent-ops")).toBe("live");
		expect(resolveRateClass("GET", "/api/canvas/events")).toBe("live");
	});

	test("non-GET on the feed path is not live (mutations stay strict)", () => {
		expect(resolveRateClass("POST", "/api/ops/feed")).toBe("action");
	});
});
