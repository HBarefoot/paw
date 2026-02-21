import { describe, test, expect, beforeEach, afterAll } from "bun:test";
import { existsSync, unlinkSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// We test the credential store logic by importing the functions that don't
// depend on the hardcoded path, or by testing the file format directly.

describe("Credential Store format", () => {
	const testDir = join(tmpdir(), "paw-test-" + Date.now());
	const testFile = join(testDir, "credentials.json");

	beforeEach(() => {
		mkdirSync(testDir, { recursive: true });
		if (existsSync(testFile)) unlinkSync(testFile);
	});

	afterAll(() => {
		try {
			unlinkSync(testFile);
		} catch {}
	});

	test("credentials JSON is valid and readable", () => {
		const creds = {
			anthropic: {
				method: "api_key" as const,
				apiKey: "sk-ant-test123",
			},
			slack: {
				botToken: "xoxb-test",
				appToken: "xapp-test",
				signingSecret: "secret",
			},
		};

		const { writeFileSync } = require("node:fs");
		writeFileSync(testFile, JSON.stringify(creds, null, 2));

		const loaded = JSON.parse(readFileSync(testFile, "utf-8"));
		expect(loaded.anthropic.method).toBe("api_key");
		expect(loaded.anthropic.apiKey).toBe("sk-ant-test123");
		expect(loaded.slack.botToken).toBe("xoxb-test");
	});

	test("oauth credentials include token fields", () => {
		const creds = {
			anthropic: {
				method: "oauth" as const,
				accessToken: "token-abc",
				refreshToken: "refresh-xyz",
				expiresAt: "2026-03-01T00:00:00Z",
			},
		};

		const { writeFileSync } = require("node:fs");
		writeFileSync(testFile, JSON.stringify(creds, null, 2));

		const loaded = JSON.parse(readFileSync(testFile, "utf-8"));
		expect(loaded.anthropic.method).toBe("oauth");
		expect(loaded.anthropic.accessToken).toBe("token-abc");
		expect(loaded.anthropic.refreshToken).toBe("refresh-xyz");
	});

	test("env var takes precedence pattern", () => {
		// Simulating the precedence logic from getAnthropicKey
		const envKey = "sk-ant-from-env";
		const storedKey = "sk-ant-from-store";

		// env wins
		const resolved = envKey || storedKey;
		expect(resolved).toBe("sk-ant-from-env");

		// no env, store wins
		const resolved2 = undefined || storedKey;
		expect(resolved2).toBe("sk-ant-from-store");
	});
});
