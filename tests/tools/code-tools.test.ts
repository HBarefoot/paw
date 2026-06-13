import { describe, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { ToolRegistry } from "../../src/ai/tools.js";
import {
	buildCodeResult,
	createCodeTools,
	resolveCodeCall,
	scrubEnv,
} from "../../src/tools/code-tools.js";
import type { ToolDefinition } from "../../src/types/message.js";
import type { Logger } from "../../src/types/plugin.js";

const noop = {
	debug() {},
	info() {},
	warn() {},
	error() {},
} as unknown as Logger;

function registryWith(tools: ToolDefinition[]): ToolRegistry {
	const reg = new ToolRegistry();
	reg.register(tools);
	return reg;
}

const ECHO: ToolDefinition = {
	name: "echo",
	description: "echo",
	plugin: "kernel",
	input_schema: { type: "object" },
	handler: async (input) => ({ content: `echo:${String(input.text ?? "")}` }),
};

function makeTool(reg: ToolRegistry): ToolDefinition {
	const [tool] = createCodeTools({
		workspacePath: tmpdir(),
		maxOutputLength: 10_000,
		execTimeout: 15_000,
		toolRegistry: reg,
		skillManager: null,
		logger: noop,
	});
	return tool;
}

describe("scrubEnv", () => {
	test("drops the vault key, provider keys, and the whole PAW_ namespace", () => {
		const out = scrubEnv({
			PATH: "/usr/bin",
			HOME: "/home/x",
			PAW_VAULT_KEY: "master",
			PAW_DB_PATH: "/data/paw.db",
			ANTHROPIC_API_KEY: "sk-ant",
			OPENAI_API_KEY: "sk-oai",
			SLACK_BOT_TOKEN: "xoxb",
			DB_PASSWORD: "hunter2",
			UNDEF: undefined,
		});
		expect(out.PATH).toBe("/usr/bin");
		expect(out.HOME).toBe("/home/x");
		expect(out.PAW_VAULT_KEY).toBeUndefined();
		expect(out.PAW_DB_PATH).toBeUndefined();
		expect(out.ANTHROPIC_API_KEY).toBeUndefined();
		expect(out.OPENAI_API_KEY).toBeUndefined();
		expect(out.SLACK_BOT_TOKEN).toBeUndefined();
		expect(out.DB_PASSWORD).toBeUndefined();
		expect("UNDEF" in out).toBe(false);
	});
});

describe("resolveCodeCall", () => {
	test("allows a tool in the active set", () => {
		expect(
			resolveCodeCall({ tool: "echo", allowed: new Set(["echo"]) }),
		).toEqual({ ok: true });
	});
	test("rejects a tool not in the active set", () => {
		const v = resolveCodeCall({
			tool: "file_write",
			allowed: new Set(["echo"]),
		});
		expect(v.ok).toBe(false);
	});
	test("rejects recursive execute_code even if somehow in the set", () => {
		const v = resolveCodeCall({
			tool: "execute_code",
			allowed: new Set(["execute_code"]),
		});
		expect(v.ok).toBe(false);
	});
	test("rejects spawn_agent", () => {
		const v = resolveCodeCall({
			tool: "spawn_agent",
			allowed: new Set(["spawn_agent"]),
		});
		expect(v.ok).toBe(false);
	});
});

describe("buildCodeResult", () => {
	test("formats a returned value plus captured output", () => {
		const r = buildCodeResult({
			finalResult: { ok: true, result: { n: 1 } },
			stdout: "hello\n",
			stderr: "",
			exitCode: 0,
			maxOutputLength: 10_000,
		});
		expect(r.is_error).toBe(false);
		expect(r.content).toContain('"n": 1');
		expect(r.content).toContain("hello");
	});
	test("flags a script error", () => {
		const r = buildCodeResult({
			finalResult: { ok: false, error: "boom" },
			stdout: "",
			stderr: "",
			exitCode: 1,
			maxOutputLength: 10_000,
		});
		expect(r.is_error).toBe(true);
		expect(r.content).toContain("boom");
	});
	test("truncates oversized output", () => {
		const r = buildCodeResult({
			finalResult: { ok: true, result: "x".repeat(100) },
			stdout: "",
			stderr: "",
			exitCode: 0,
			maxOutputLength: 20,
		});
		expect(r.content).toContain("truncated");
		expect(r.content.length).toBeLessThan(60);
	});
});

describe("execute_code (real child process)", () => {
	test("a snippet round-trips paw.call through the registry and returns a value", async () => {
		const tool = makeTool(registryWith([ECHO]));
		const res = await tool.handler({
			code: 'const out = await paw.call("echo", { text: "hi" });\nreturn out.toUpperCase();',
		});
		expect(res.is_error).toBeFalsy();
		expect(res.content).toContain("ECHO:HI");
	});

	test("calling a tool outside the active set is rejected inside the script", async () => {
		const tool = makeTool(registryWith([ECHO]));
		const res = await tool.handler({
			code: 'return await paw.call("file_write", { path: "x", content: "y" });',
		});
		expect(res.is_error).toBe(true);
		expect(res.content).toContain("not in the active skill set");
	});

	test("execute_code cannot call itself (recursion guard)", async () => {
		const tool = makeTool(registryWith([ECHO]));
		const res = await tool.handler({
			code: 'return await paw.call("execute_code", { code: "return 1" });',
		});
		expect(res.is_error).toBe(true);
		expect(res.content).toContain("cannot call itself");
	});

	test("the child process cannot read PAW_VAULT_KEY from the env", async () => {
		const prev = process.env.PAW_VAULT_KEY;
		process.env.PAW_VAULT_KEY = "super-secret-master-key";
		try {
			const tool = makeTool(registryWith([ECHO]));
			const res = await tool.handler({
				code: 'return process.env.PAW_VAULT_KEY ? "LEAKED" : "ABSENT";',
			});
			expect(res.content).toContain("ABSENT");
			expect(res.content).not.toContain("LEAKED");
		} finally {
			if (prev === undefined)
				Reflect.deleteProperty(process.env, "PAW_VAULT_KEY");
			else process.env.PAW_VAULT_KEY = prev;
		}
	});

	test("a runaway snippet is killed by the timeout", async () => {
		const [tool] = createCodeTools({
			workspacePath: tmpdir(),
			maxOutputLength: 10_000,
			execTimeout: 800,
			toolRegistry: registryWith([ECHO]),
			skillManager: null,
			logger: noop,
		});
		const res = await tool.handler({
			code: "while (true) {}",
		});
		expect(res.is_error).toBe(true);
	});
});
