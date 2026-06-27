import { describe, expect, mock, test } from "bun:test";
import type { ChatMessage } from "../../src/ai/base-provider.js";
import type { ToolDefinition } from "../../src/types/message.js";
import type { Logger } from "../../src/types/plugin.js";

// The tool list is hoisted out of the roundtrip loop (and only recomputed when
// an activate_skill fires this turn). These tests prove that invariant — they
// FAIL on the pre-fix code, which called getTools() inside the loop on every
// roundtrip (busting the Anthropic tool-prefix cache and re-running the full
// registry filter up to maxToolRoundtrips times).

const noop = {
	debug() {},
	info() {},
	warn() {},
	error() {},
} as unknown as Logger;

type Final = {
	content: Array<Record<string, unknown>>;
	stop_reason: string;
	usage?: { input_tokens: number; output_tokens: number };
};

/**
 * Mock the Anthropic SDK so `client.messages.stream(params).finalMessage()`
 * returns a scripted sequence of responses, capturing the `tools` handed to
 * each roundtrip.
 */
function mockAnthropic(script: Final[], capturedTools: unknown[][]) {
	let i = 0;
	mock.module("@anthropic-ai/sdk", () => ({
		default: class {
			messages = {
				stream: (params: { tools?: unknown[] }) => {
					capturedTools.push((params.tools ?? []) as unknown[]);
					const final = script[Math.min(i, script.length - 1)];
					i++;
					return { finalMessage: async () => final };
				},
			};
		},
	}));
}

const PING: ToolDefinition = {
	name: "ping",
	description: "always-active ping",
	input_schema: { type: "object" },
	plugin: "core", // skill "core" is always-active
	handler: async () => ({ content: "pong" }),
};

const DEMO: ToolDefinition = {
	name: "demo_tool",
	description: "on-demand demo tool",
	input_schema: { type: "object" },
	plugin: "demo", // on-demand skill "demo"
	handler: async () => ({ content: "demo-ran" }),
};

async function makeProvider(tools: ToolDefinition[]) {
	const { ClaudeProvider } = await import("../../src/ai/provider.js");
	const { ToolRegistry } = await import("../../src/ai/tools.js");
	const { SkillManager } = await import("../../src/ai/skills.js");

	const registry = new ToolRegistry();
	registry.register(tools);
	const skills = new SkillManager();
	skills.buildFromRegistry(registry);

	// Spy on the per-call hook the provider's getTools() uses.
	const real = skills.getActiveToolNames.bind(skills);
	let calls = 0;
	skills.getActiveToolNames = (sid: string) => {
		calls++;
		return real(sid);
	};

	const provider = new ClaudeProvider(
		{
			apiKey: "k",
			authMethod: "api_key",
			model: "claude-test",
			maxTokens: 64,
			maxToolRoundtrips: 5,
		},
		registry,
		noop,
		skills,
	);
	return { provider, getActiveCalls: () => calls };
}

const userTurn: ChatMessage[] = [{ role: "user", content: "go" }];

describe("Claude provider — tool list hoisting", () => {
	test("getTools is computed ONCE per turn when no skill activates", async () => {
		const captured: unknown[][] = [];
		// Roundtrip 0 calls a tool (loop continues); roundtrip 1 ends the turn.
		mockAnthropic(
			[
				{
					content: [{ type: "tool_use", id: "t1", name: "ping", input: {} }],
					stop_reason: "tool_use",
				},
				{ content: [{ type: "text", text: "done" }], stop_reason: "end_turn" },
			],
			captured,
		);

		const { provider, getActiveCalls } = await makeProvider([PING, DEMO]);
		await provider.chat(userTurn, "sys", "session-hoist");

		// Two roundtrips ran, but the tool list was resolved a single time.
		expect(captured.length).toBe(2);
		expect(getActiveCalls()).toBe(1);
		// Same (byte-identical) tool prefix on both roundtrips → cacheable.
		expect(captured[0]).toEqual(captured[1]);
	});

	test("activate_skill forces exactly one recompute; the new tools appear next roundtrip", async () => {
		const captured: unknown[][] = [];
		// Roundtrip 0 activates the on-demand "demo" skill; roundtrip 1 ends.
		mockAnthropic(
			[
				{
					content: [
						{
							type: "tool_use",
							id: "a1",
							name: "activate_skill",
							input: { skill: "demo" },
						},
					],
					stop_reason: "tool_use",
				},
				{ content: [{ type: "text", text: "done" }], stop_reason: "end_turn" },
			],
			captured,
		);

		const { provider, getActiveCalls } = await makeProvider([PING, DEMO]);
		await provider.chat(userTurn, "sys", "session-activate");

		const names = (arr: unknown[]) =>
			(arr as Array<{ name: string }>).map((t) => t.name);

		// Recomputed once after activation: initial + post-activate = 2.
		expect(getActiveCalls()).toBe(2);
		// demo_tool was NOT advertised before activation...
		expect(names(captured[0])).not.toContain("demo_tool");
		// ...and appears after it, with the always-active ping still present.
		expect(names(captured[1])).toContain("demo_tool");
		expect(names(captured[1])).toContain("ping");
	});
});
