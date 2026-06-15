import { describe, expect, test } from "bun:test";
import { configSchema } from "../../src/config/schema.js";

const phSchema = configSchema.shape.posthog;

describe("posthog config block", () => {
	test("absent → safe disabled defaults (no regression for non-users)", () => {
		const ph = phSchema.parse(undefined);
		expect(ph.enabled).toBe(false);
		expect(ph.projectApiKey).toBe("");
		expect(ph.personalApiKey).toBe("");
		expect(ph.projectId).toBe("");
		expect(ph.host).toBe("https://us.i.posthog.com");
	});

	test("parses operator values; key fields are plain strings", () => {
		const ph = phSchema.parse({
			enabled: true,
			projectApiKey: "phc_pub",
			personalApiKey: "phx_priv",
			projectId: "12345",
			host: "https://eu.i.posthog.com",
		});
		expect(ph.enabled).toBe(true);
		expect(ph.projectApiKey).toBe("phc_pub");
		expect(ph.projectId).toBe("12345");
		expect(ph.host).toBe("https://eu.i.posthog.com");
	});

	test("timeout must be a positive int", () => {
		expect(() => phSchema.parse({ timeout: -1 })).toThrow();
	});
});
