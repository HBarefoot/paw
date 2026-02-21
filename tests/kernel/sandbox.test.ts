import { describe, test, expect } from "bun:test";
import { Sandbox } from "../../src/kernel/sandbox.js";
import { createLogger } from "../../src/observability/logger.js";

const logger = createLogger("test");

describe("Sandbox", () => {
	test("grants exact permission match", () => {
		const sandbox = new Sandbox(logger);
		sandbox.registerManifest({
			name: "test",
			version: "0.1.0",
			description: "",
			permissions: ["browser"],
		});

		expect(sandbox.checkPermission("test", "browser")).toBe(true);
		expect(sandbox.checkPermission("test", "exec")).toBe(false);
	});

	test("grants wildcard permission match", () => {
		const sandbox = new Sandbox(logger);
		sandbox.registerManifest({
			name: "slack",
			version: "0.1.0",
			description: "",
			permissions: ["net:*.slack.com"],
		});

		expect(sandbox.checkPermission("slack", "net:api.slack.com")).toBe(true);
		expect(sandbox.checkPermission("slack", "net:wss-primary.slack.com")).toBe(
			true,
		);
		expect(sandbox.checkPermission("slack", "net:evil.com")).toBe(false);
	});

	test("denies unknown plugin", () => {
		const sandbox = new Sandbox(logger);
		expect(sandbox.checkPermission("nonexistent", "anything")).toBe(false);
	});
});
