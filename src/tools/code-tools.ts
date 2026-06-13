import { unlinkSync } from "node:fs";
import { resolve } from "node:path";
import type { SkillManager } from "../ai/skills.js";
import type { ToolRegistry } from "../ai/tools.js";
import type { ToolDefinition, ToolResult } from "../types/message.js";
import type { Logger } from "../types/plugin.js";

export interface CodeToolsDeps {
	workspacePath: string;
	maxOutputLength: number;
	execTimeout: number;
	toolRegistry: ToolRegistry;
	skillManager: SkillManager | null;
	logger: Logger;
}

// Env var names that must never reach the sandboxed child: the vault master key
// and every provider/integration secret. Matched by substring (case-insensitive)
// plus the whole PAW_ namespace, so new secrets are scrubbed without a code change.
const SECRET_ENV_RE = /KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|API/i;

/**
 * Strip secrets from an env before handing it to the child process. Drops the
 * entire `PAW_*` namespace (incl. `PAW_VAULT_KEY`) and any var whose name looks
 * like a credential, keeping operational vars (PATH/HOME/…) so `bun` can run.
 * Pure + exported so the security invariant is unit-testable.
 */
export function scrubEnv(
	env: Record<string, string | undefined>,
): Record<string, string> {
	const out: Record<string, string> = {};
	for (const [k, v] of Object.entries(env)) {
		if (v === undefined) continue;
		if (k.startsWith("PAW_")) continue;
		if (SECRET_ENV_RE.test(k)) continue;
		out[k] = v;
	}
	return out;
}

/**
 * Decide whether a tool call made from inside `execute_code` is allowed. The
 * script may only reach tools the model itself has active this turn, never
 * `execute_code` (no recursion) and never `spawn_agent`. Pure + exported.
 */
export function resolveCodeCall(opts: {
	tool: string;
	allowed: Set<string>;
}): { ok: true } | { ok: false; reason: string } {
	if (opts.tool === "execute_code")
		return { ok: false, reason: "execute_code cannot call itself" };
	if (opts.tool === "spawn_agent")
		return {
			ok: false,
			reason: "spawn_agent is not available from execute_code",
		};
	if (!opts.allowed.has(opts.tool))
		return {
			ok: false,
			reason: `tool '${opts.tool}' is not in the active skill set`,
		};
	return { ok: true };
}

const CHILD_ENTRY = new URL("./code-runner-child.ts", import.meta.url).pathname;

const DESCRIPTION = [
	"Run a TypeScript/JavaScript snippet that orchestrates other tools in ONE turn.",
	"Inside the snippet, call agent tools with `await paw.call(toolName, inputObject)`",
	"— it returns the tool's text output. End the snippet with `return <value>` to",
	"report a result. Use this instead of chaining many exec_command calls when a task",
	"needs several steps, loops, or to pass one tool's output into the next.",
	"Constraints: no `import` (use paw.call); the snippet runs in an isolated process",
	"with NO access to secrets/credentials; it cannot call execute_code or spawn_agent.",
].join(" ");

/**
 * `execute_code`: runs a model-written snippet in an isolated child Bun process
 * with a scrubbed env, bridging `paw.call(tool, input)` back to this registry
 * over IPC. Every bridged call still flows through `toolRegistry.execute`, so
 * sandbox permission checks and tool logging apply unchanged.
 */
export function createCodeTools(deps: CodeToolsDeps): ToolDefinition[] {
	const executeCode: ToolDefinition = {
		name: "execute_code",
		description: DESCRIPTION,
		plugin: "kernel",
		input_schema: {
			type: "object",
			properties: {
				code: {
					type: "string",
					description:
						"The TS/JS snippet to run. Use `await paw.call(name, input)` and `return` a value.",
				},
				timeout_ms: {
					type: "number",
					description: `Timeout in ms (default + cap: ${deps.execTimeout})`,
				},
			},
			required: ["code"],
		},
		handler: async (input): Promise<ToolResult> => {
			const code = typeof input.code === "string" ? input.code : "";
			if (!code.trim()) {
				return { content: "Error: 'code' is required", is_error: true };
			}
			const sessionId =
				typeof input.__sessionId === "string" ? input.__sessionId : undefined;
			const timeout =
				typeof input.timeout_ms === "number"
					? Math.min(input.timeout_ms, deps.execTimeout)
					: deps.execTimeout;

			// The script may reach only what the model has active this turn. With no
			// session context, fall back to every registered tool (the recursion +
			// spawn_agent guards in resolveCodeCall still apply).
			const allowed: Set<string> =
				sessionId && deps.skillManager
					? deps.skillManager.getActiveToolNames(sessionId)
					: new Set(deps.toolRegistry.toolNames());

			const scriptPath = resolve(
				deps.workspacePath,
				`.paw-code-${crypto.randomUUID()}.ts`,
			);
			await Bun.write(scriptPath, code);

			let finalResult: {
				ok: boolean;
				result?: unknown;
				error?: string;
			} | null = null;

			try {
				const proc = Bun.spawn(["bun", "run", CHILD_ENTRY, scriptPath], {
					cwd: deps.workspacePath,
					env: scrubEnv(process.env),
					stdout: "pipe",
					stderr: "pipe",
					ipc: (message, sub) => {
						const m = message as {
							type?: string;
							id?: string;
							tool?: string;
							input?: Record<string, unknown>;
							ok?: boolean;
							result?: unknown;
							error?: string;
						};
						if (m?.type === "call" && m.id && m.tool) {
							const callId = m.id;
							const toolName = m.tool;
							void (async () => {
								const verdict = resolveCodeCall({ tool: toolName, allowed });
								if (!verdict.ok) {
									sub.send({
										type: "result",
										id: callId,
										result: {
											content: `Error: ${verdict.reason}`,
											is_error: true,
										},
									});
									return;
								}
								try {
									const res = await deps.toolRegistry.execute(
										toolName,
										m.input ?? {},
										sessionId,
									);
									sub.send({ type: "result", id: callId, result: res });
								} catch (err) {
									sub.send({
										type: "result",
										id: callId,
										result: {
											content: `Error: ${String(err)}`,
											is_error: true,
										},
									});
								}
							})();
						} else if (m?.type === "done") {
							finalResult = { ok: !!m.ok, result: m.result, error: m.error };
						}
					},
				});

				const timeoutId = setTimeout(() => proc.kill(), timeout);
				const [stdout, stderr] = await Promise.all([
					new Response(proc.stdout).text(),
					new Response(proc.stderr).text(),
				]);
				const exitCode = await proc.exited;
				clearTimeout(timeoutId);

				return buildCodeResult({
					finalResult,
					stdout,
					stderr,
					exitCode,
					maxOutputLength: deps.maxOutputLength,
				});
			} catch (err) {
				deps.logger.warn("execute_code failed to run", {
					error: String(err),
				});
				return {
					content: `Error running code: ${err instanceof Error ? err.message : String(err)}`,
					is_error: true,
				};
			} finally {
				try {
					unlinkSync(scriptPath);
				} catch {
					// best-effort cleanup
				}
			}
		},
	};

	return [executeCode];
}

/** Assemble the ToolResult from the child's reported result + captured output. */
export function buildCodeResult(opts: {
	finalResult: { ok: boolean; result?: unknown; error?: string } | null;
	stdout: string;
	stderr: string;
	exitCode: number;
	maxOutputLength: number;
}): ToolResult {
	const { finalResult, stdout, stderr, exitCode, maxOutputLength } = opts;
	const parts: string[] = [];
	if (finalResult) {
		if (finalResult.ok) {
			const r = finalResult.result;
			if (r !== undefined && r !== null) {
				parts.push(typeof r === "string" ? r : JSON.stringify(r, null, 2));
			}
		} else {
			parts.push(`Script error: ${finalResult.error ?? "unknown error"}`);
		}
	} else {
		parts.push(`[script reported no result; exit code ${exitCode}]`);
	}
	const logs = (stdout + (stderr ? `\n--- stderr ---\n${stderr}` : "")).trim();
	if (logs) parts.push(`--- output ---\n${logs}`);

	let content = parts.join("\n\n") || "[no output]";
	if (content.length > maxOutputLength) {
		content = `${content.slice(0, maxOutputLength)}\n... (truncated)`;
	}
	const isError = finalResult ? !finalResult.ok : exitCode !== 0;
	return { content, is_error: isError };
}
