import { describe, expect, test } from "bun:test";
import {
	APP_ASSET_LIMIT_PER_MIN,
	isAppAssetGet,
} from "../../src/web/rate-limit-policy.js";
import { RateLimiter } from "../../src/security/rate-limiter.js";

describe("isAppAssetGet", () => {
	test("classifies app-space asset GETs", () => {
		expect(isAppAssetGet("GET", "/api/app/constructai/index.html")).toBe(true);
		expect(isAppAssetGet("GET", "/api/app/x/assets/app.js")).toBe(true);
	});
	test("excludes non-GET and non-app-space routes", () => {
		expect(isAppAssetGet("POST", "/api/app/x/index.html")).toBe(false);
		expect(isAppAssetGet("GET", "/api/chat/stream")).toBe(false);
		expect(isAppAssetGet("GET", "/api/canvas/preview/index.html")).toBe(false);
		// not fooled by a similar prefix
		expect(isAppAssetGet("GET", "/api/apple")).toBe(false);
	});
	test("app-space budget is much higher than the shared 60/min", () => {
		expect(APP_ASSET_LIMIT_PER_MIN).toBeGreaterThan(60);
	});
});

describe("rate-limit selection (mirrors the /api/* middleware)", () => {
	// Reproduce exactly what the middleware does: pick the limiter by policy.
	function consume(
		method: string,
		path: string,
		api: RateLimiter,
		asset: RateLimiter,
		ip: string,
	): boolean {
		const limiter = isAppAssetGet(method, path) ? asset : api;
		return limiter.check(ip).allowed;
	}

	test("a burst of >60 app-space asset GETs all succeed (fails on pre-fix code)", () => {
		const api = new RateLimiter(60);
		const asset = new RateLimiter(APP_ASSET_LIMIT_PER_MIN);
		const ip = "1.2.3.4";
		let ok = 0;
		for (let i = 0; i < 200; i++) {
			if (consume("GET", `/api/app/s/asset-${i}.js`, api, asset, ip)) ok++;
		}
		expect(ok).toBe(200); // all 200 allowed — pre-fix, the 61st would 429
	});

	test("the shared /api/* budget is unchanged: 61st normal request → blocked", () => {
		const api = new RateLimiter(60);
		const asset = new RateLimiter(APP_ASSET_LIMIT_PER_MIN);
		const ip = "5.6.7.8";
		for (let i = 0; i < 60; i++) {
			expect(consume("GET", "/api/chat/stream", api, asset, ip)).toBe(true);
		}
		expect(consume("GET", "/api/chat/stream", api, asset, ip)).toBe(false);
	});

	test("the two budgets are independent (app-space load doesn't drain the shared one)", () => {
		const api = new RateLimiter(60);
		const asset = new RateLimiter(APP_ASSET_LIMIT_PER_MIN);
		const ip = "9.9.9.9";
		for (let i = 0; i < 100; i++) {
			consume("GET", `/api/app/s/a-${i}.css`, api, asset, ip);
		}
		// shared budget still fully available
		expect(consume("GET", "/api/memory", api, asset, ip)).toBe(true);
	});

	test("non-GET app-space requests still use the shared budget", () => {
		const api = new RateLimiter(60);
		const asset = new RateLimiter(APP_ASSET_LIMIT_PER_MIN);
		const ip = "4.4.4.4";
		for (let i = 0; i < 60; i++) {
			expect(consume("POST", "/api/app/s/submit", api, asset, ip)).toBe(true);
		}
		expect(consume("POST", "/api/app/s/submit", api, asset, ip)).toBe(false);
	});
});
