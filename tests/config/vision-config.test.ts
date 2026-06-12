import { describe, expect, test } from "bun:test";
import { configSchema } from "../../src/config/schema.js";

// The ai sub-schema in isolation (all its fields have defaults).
const aiSchema = configSchema.shape.ai;

describe("ai.vision config", () => {
	test("absent by default → undefined (text-only deploys unchanged)", () => {
		expect(aiSchema.parse({}).vision).toBeUndefined();
	});

	test("parses provider + model; enabled defaults to true", () => {
		const ai = aiSchema.parse({
			vision: { provider: "openai", model: "gpt-4o" },
		});
		expect(ai.vision).toEqual({
			provider: "openai",
			model: "gpt-4o",
			enabled: true,
		});
	});

	test("respects enabled:false", () => {
		const ai = aiSchema.parse({
			vision: { provider: "gemini", model: "gemini-2.0-flash", enabled: false },
		});
		expect(ai.vision?.enabled).toBe(false);
	});

	test("model is required when vision is present", () => {
		expect(() => aiSchema.parse({ vision: { provider: "openai" } })).toThrow();
	});

	test("provider must be a known id", () => {
		expect(() =>
			aiSchema.parse({ vision: { provider: "mystery", model: "x" } }),
		).toThrow();
	});
});
