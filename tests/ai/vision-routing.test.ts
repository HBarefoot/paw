import { describe, expect, test } from "bun:test";
import type { AIProvider } from "../../src/ai/base-provider.js";
import {
	ProviderRouter,
	VISION_ERROR_NOTE,
	VISION_UNCONFIGURED_NOTE,
	planImageTurn,
	withVisionFallback,
} from "../../src/ai/router.js";
import type { Logger } from "../../src/types/plugin.js";

const noop = {
	debug() {},
	info() {},
	warn() {},
	error() {},
} as unknown as Logger;
const def = { name: "default" } as unknown as AIProvider;
const vis = { name: "vision" } as unknown as AIProvider;

function router(visionProvider: AIProvider | null): ProviderRouter {
	return new ProviderRouter({
		providers: new Map(),
		rules: [],
		defaultProvider: def,
		visionProvider,
		logger: noop,
	});
}

describe("ProviderRouter.selectForImageTurn (the vision rule)", () => {
	test("image turn → vision provider; text turn → default", () => {
		const r = router(vis);
		expect(r.selectForImageTurn(true)).toBe(vis);
		expect(r.selectForImageTurn(false)).toBe(def);
	});

	test("no vision provider configured → default even on an image turn", () => {
		expect(router(null).selectForImageTurn(true)).toBe(def);
	});
});

describe("planImageTurn", () => {
	test("image + vision configured → use vision, no note", () => {
		expect(
			planImageTurn({
				hasImage: true,
				visionConfigured: true,
				defaultCanSeeImages: false,
			}),
		).toEqual({ useVision: true, note: null });
	});

	test("image + no vision + text-only default → unconfigured note", () => {
		expect(
			planImageTurn({
				hasImage: true,
				visionConfigured: false,
				defaultCanSeeImages: false,
			}),
		).toEqual({ useVision: false, note: "unconfigured" });
	});

	test("image + no vision + vision-capable default → no note (it can see it)", () => {
		expect(
			planImageTurn({
				hasImage: true,
				visionConfigured: false,
				defaultCanSeeImages: true,
			}),
		).toEqual({ useVision: false, note: null });
	});

	test("text turn → no vision, no note (default route untouched)", () => {
		expect(
			planImageTurn({
				hasImage: false,
				visionConfigured: true,
				defaultCanSeeImages: false,
			}),
		).toEqual({ useVision: false, note: null });
	});
});

describe("withVisionFallback", () => {
	test("vision provider throws → degrades to default, keeps the turn", async () => {
		const r = await withVisionFallback({
			isVision: true,
			primary: () => Promise.reject(new Error("auth failed")),
			onFallback: () => Promise.resolve("default-answer"),
		});
		expect(r).toEqual({ value: "default-answer", usedFallback: true });
	});

	test("vision succeeds → no fallback", async () => {
		const r = await withVisionFallback({
			isVision: true,
			primary: () => Promise.resolve("vision-answer"),
			onFallback: () => Promise.resolve("unused"),
		});
		expect(r).toEqual({ value: "vision-answer", usedFallback: false });
	});

	test("non-vision error propagates (never silently swallowed/dropped)", async () => {
		await expect(
			withVisionFallback({
				isVision: false,
				primary: () => Promise.reject(new Error("boom")),
				onFallback: () => Promise.resolve("unused"),
			}),
		).rejects.toThrow("boom");
	});
});

describe("vision notes", () => {
	test("present, distinct, and the unconfigured note points at ai.vision", () => {
		expect(VISION_UNCONFIGURED_NOTE).toContain("ai.vision");
		expect(VISION_ERROR_NOTE.length).toBeGreaterThan(0);
		expect(VISION_UNCONFIGURED_NOTE).not.toBe(VISION_ERROR_NOTE);
	});
});
