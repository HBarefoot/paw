import type { Sandbox } from "../kernel/sandbox.js";
import type { ToolDefinition, ToolResult } from "../types/message.js";
import type { ToolLog } from "../observability/tool-log.js";

export class ToolRegistry {
	private tools = new Map<string, ToolDefinition>();
	private sandbox: Sandbox | null = null;
	private enforcePermissions = false;
	private toolLog: ToolLog | null = null;

	setToolLog(log: ToolLog | null): void {
		this.toolLog = log;
	}

	register(tools: ToolDefinition[]): void {
		for (const tool of tools) {
			if (this.tools.has(tool.name)) {
				throw new Error(`Tool "${tool.name}" is already registered`);
			}
			this.tools.set(tool.name, tool);
		}
	}

	has(name: string): boolean {
		return this.tools.has(name);
	}

	setSandbox(sandbox: Sandbox, enforce = true): void {
		this.sandbox = sandbox;
		this.enforcePermissions = enforce;
	}

	unregisterPlugin(pluginName: string): void {
		for (const [name, tool] of this.tools) {
			if (tool.plugin === pluginName) {
				this.tools.delete(name);
			}
		}
	}

	get(name: string): ToolDefinition | undefined {
		return this.tools.get(name);
	}

	async execute(
		name: string,
		input: Record<string, unknown>,
	): Promise<ToolResult> {
		const tool = this.tools.get(name);
		const start = Date.now();
		if (!tool) {
			this.toolLog?.record({
				toolName: name,
				input,
				output: `Unknown tool: ${name}`,
				isError: true,
				durationMs: Date.now() - start,
			});
			return { content: `Unknown tool: ${name}`, is_error: true };
		}

		// Sandbox permission check (H-NEW-4). Previously the check was
		// bypassed for built-in tools (plugin === "kernel"), which meant
		// file_*, exec_command, and memory_* were effectively
		// un-sandboxed. Now the kernel manifest lists all built-in
		// permissions, so this check fires for every tool.
		if (this.sandbox && this.enforcePermissions) {
			const permitted = this.sandbox.checkPermission(
				tool.plugin,
				this.inferPermission(tool),
			);
			if (!permitted) {
				const msg = `Permission denied: ${tool.plugin} cannot use ${name}`;
				this.toolLog?.record({
					toolName: name,
					plugin: tool.plugin,
					input,
					output: msg,
					isError: true,
					durationMs: Date.now() - start,
				});
				return { content: msg, is_error: true };
			}
		}

		try {
			const result = await tool.handler(input);
			this.toolLog?.record({
				toolName: name,
				plugin: tool.plugin,
				input,
				output: result.content,
				isError: !!result.is_error,
				durationMs: Date.now() - start,
			});
			return result;
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			this.toolLog?.record({
				toolName: name,
				plugin: tool.plugin,
				input,
				output: msg,
				isError: true,
				durationMs: Date.now() - start,
			});
			return { content: `Tool error: ${msg}`, is_error: true };
		}
	}

	private inferPermission(tool: ToolDefinition): string {
		// Infer required permission from tool name. The kernel manifest
		// must list every permission this returns, or the check will
		// refuse the call.
		if (tool.name.startsWith("mcp__")) return tool.plugin; // mcp:<server>
		if (tool.name.startsWith("browser_")) return "browser";
		if (tool.name.startsWith("slack_")) return "net:*.slack.com";
		if (tool.name.startsWith("file_read") || tool.name.startsWith("file_list"))
			return "file:read";
		if (tool.name.startsWith("file_write") || tool.name === "file_write")
			return "file:write";
		if (tool.name === "exec_command") return "exec";
		if (tool.name === "memory_recall") return "memory:read";
		if (tool.name === "memory_store" || tool.name === "import_document")
			return "memory:write";
		if (tool.name === "memory_forget") return "memory:forget";
		if (tool.name.startsWith("canvas_read") || tool.name === "canvas_list")
			return "canvas:read";
		if (
			tool.name === "canvas_write" ||
			tool.name === "canvas_mkdir" ||
			tool.name === "canvas_delete" ||
			tool.name === "canvas_move"
		)
			return "canvas:write";
		if (tool.name.startsWith("canvas_action")) return "canvas:write";
		if (
			tool.name === "create_proactive_trigger" ||
			tool.name === "remove_proactive_trigger"
		)
			return "cron:create";
		if (tool.name.startsWith("github_")) {
			// Read = get/list/read/search/check; admin = merge/delete/dispatch/
			// close/rerun (irreversible, approval-gated); everything else is write.
			if (/^github_(get|list|read|search|check)/.test(tool.name))
				return "github:read";
			if (/^github_(merge|delete|dispatch|close|rerun)/.test(tool.name))
				return "github:admin";
			return "github:write";
		}
		if (tool.name === "spawn_agent") return "agent:spawn";
		if (tool.name === "delegate_task") return "agent:delegate";
		if (tool.name === "activate_skill") return "skill:activate";
		return tool.plugin;
	}

	allTools(): IterableIterator<ToolDefinition> {
		return this.tools.values();
	}

	toAnthropicTools(): Array<{
		name: string;
		description: string;
		input_schema: Record<string, unknown>;
	}> {
		return Array.from(this.tools.values()).map((t) => ({
			name: t.name,
			description: t.description,
			input_schema: t.input_schema,
		}));
	}

	toAnthropicToolsFiltered(allowedNames: Set<string>): Array<{
		name: string;
		description: string;
		input_schema: Record<string, unknown>;
	}> {
		return Array.from(this.tools.values())
			.filter((t) => allowedNames.has(t.name))
			.map((t) => ({
				name: t.name,
				description: t.description,
				input_schema: t.input_schema,
			}));
	}

	get size(): number {
		return this.tools.size;
	}
}
