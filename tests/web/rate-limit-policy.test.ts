import { describe, expect, test } from "bun:test";
import {
	APP_ASSET_LIMIT_PER_MIN,
	type RateClass,
	chrome429ContentType,
	isAppAssetGet,
	limitForClass,
	resolveRateClass,
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

describe("resolveRateClass", () => {
	test("brand chrome reads (css/tokens/ui/asset) → chrome", () => {
		expect(resolveRateClass("GET", "/api/brand/theme.css")).toBe("chrome");
		expect(resolveRateClass("GET", "/api/brand/tokens.css")).toBe("chrome");
		expect(resolveRateClass("GET", "/api/brand/ui")).toBe("chrome");
		expect(resolveRateClass("GET", "/api/brand/asset/logo.png")).toBe("chrome");
	});
	test("interval/live reads → live", () => {
		for (const p of [
			"/api/notifications",
			"/api/agent-ops",
			"/api/canvas/events",
			"/api/canvas/files",
			"/api/canvas/preview/index.html",
			"/api/github/events",
			"/api/github/pending",
		]) {
			expect(resolveRateClass("GET", p)).toBe("live");
		}
	});
	test("app-space assets → app-asset (#51 preserved)", () => {
		expect(resolveRateClass("GET", "/api/app/x/index.html")).toBe("app-asset");
	});
	test("everything else + all non-GET → action", () => {
		expect(resolveRateClass("GET", "/api/chat/stream")).toBe("action");
		expect(resolveRateClass("GET", "/api/memory")).toBe("action");
		// non-GET stays strict even on a live/chrome path
		expect(resolveRateClass("POST", "/api/notifications/read")).toBe("action");
		expect(resolveRateClass("POST", "/api/brand/activate")).toBe("action");
		// GET to a notifications SUB-path (an action) is not the live poll
		expect(resolveRateClass("GET", "/api/notifications/read")).toBe("action");
		// not fooled by similar prefixes
		expect(resolveRateClass("GET", "/api/brandish")).toBe("action");
	});
});

describe("chrome429ContentType", () => {
	test("matches the asset's content-type so a 429 doesn't MIME-break", () => {
		expect(chrome429ContentType("/api/brand/theme.css")).toBe("text/css");
		expect(chrome429ContentType("/api/brand/tokens.css")).toBe("text/css");
		expect(chrome429ContentType("/api/brand/ui")).toBe("application/json");
		expect(chrome429ContentType("/api/brand/asset/logo.png")).toBeNull();
	});
});

describe("multi-class rate-limit selection (mirrors the /api/* middleware)", () => {
	function makeLimiters(): Record<RateClass, RateLimiter> {
		return {
			action: new RateLimiter(limitForClass("action")),
			"app-asset": new RateLimiter(limitForClass("app-asset")),
			chrome: new RateLimiter(limitForClass("chrome")),
			live: new RateLimiter(limitForClass("live")),
		};
	}
	function consume(
		limiters: Record<RateClass, RateLimiter>,
		method: string,
		path: string,
		ip: string,
	): boolean {
		return limiters[resolveRateClass(method, path)].check(ip).allowed;
	}

	test("a >60 burst of pre-auth chrome GETs all succeed (fails on pre-fix code)", () => {
		const L = makeLimiters();
		const ip = "1.1.1.1";
		let ok = 0;
		for (let i = 0; i < 200; i++) {
			if (consume(L, "GET", "/api/brand/theme.css", ip)) ok++;
		}
		expect(ok).toBe(200);
	});

	test("a >60 burst of notification polls all succeed (fails on pre-fix code)", () => {
		const L = makeLimiters();
		const ip = "2.2.2.2";
		let ok = 0;
		for (let i = 0; i < 200; i++) {
			if (consume(L, "GET", "/api/notifications", ip)) ok++;
		}
		expect(ok).toBe(200);
	});

	test("the strict action budget is unchanged: 61st action → blocked", () => {
		const L = makeLimiters();
		const ip = "3.3.3.3";
		for (let i = 0; i < 60; i++) {
			expect(consume(L, "GET", "/api/chat/stream", ip)).toBe(true);
		}
		expect(consume(L, "GET", "/api/chat/stream", ip)).toBe(false);
	});

	test("the four class budgets are mutually independent", () => {
		const L = makeLimiters();
		const ip = "4.4.4.4";
		// Hammer chrome + live + app-asset hard...
		for (let i = 0; i < 150; i++) {
			consume(L, "GET", "/api/brand/asset/a.png", ip);
			consume(L, "GET", "/api/canvas/events", ip);
			consume(L, "GET", `/api/app/s/${i}.js`, ip);
		}
		// ...the action budget is still fully available.
		expect(consume(L, "GET", "/api/memory", ip)).toBe(true);
	});
});
