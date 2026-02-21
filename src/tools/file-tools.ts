import { resolve, relative } from "node:path";
import { existsSync, statSync, readdirSync, realpathSync } from "node:fs";
import type { ToolDefinition, ToolResult } from "../types/message.js";

interface FileToolsConfig {
	workspacePath: string;
	maxFileSize: number;
	maxOutputLength: number;
}

function safePath(filePath: string, workspace: string): string | null {
	const resolved = resolve(workspace, filePath);
	// Check logical path first (no ".." traversal, no null bytes)
	const rel = relative(workspace, resolved);
	if (rel.startsWith("..") || resolved.includes("\0")) return null;
	// If the path exists, resolve symlinks and verify the real path is still within workspace
	if (existsSync(resolved)) {
		try {
			const real = realpathSync(resolved);
			const realRel = relative(workspace, real);
			if (realRel.startsWith("..")) return null;
		} catch {
			return null;
		}
	}
	return resolved;
}

export function createFileTools(config: FileToolsConfig): ToolDefinition[] {
	const workspace = resolve(config.workspacePath);

	const fileRead: ToolDefinition = {
		name: "file_read",
		description: "Read the contents of a file within the workspace directory.",
		plugin: "kernel",
		input_schema: {
			type: "object",
			properties: {
				path: {
					type: "string",
					description: "File path relative to workspace",
				},
				offset: {
					type: "number",
					description: "Line offset to start reading from (0-based)",
				},
				limit: { type: "number", description: "Max number of lines to return" },
			},
			required: ["path"],
		},
		handler: async (input): Promise<ToolResult> => {
			const filePath = safePath(input.path as string, workspace);
			if (!filePath)
				return { content: "Error: path is outside workspace", is_error: true };

			if (!existsSync(filePath))
				return {
					content: `Error: file not found: ${input.path}`,
					is_error: true,
				};

			const stat = statSync(filePath);
			if (stat.isDirectory())
				return {
					content: "Error: path is a directory, use file_list instead",
					is_error: true,
				};
			if (stat.size > config.maxFileSize) {
				return {
					content: `Error: file too large (${stat.size} bytes, max ${config.maxFileSize})`,
					is_error: true,
				};
			}

			const file = Bun.file(filePath);
			let text = await file.text();
			const lines = text.split("\n");

			const offset = typeof input.offset === "number" ? input.offset : 0;
			const limit =
				typeof input.limit === "number" ? input.limit : lines.length;
			const sliced = lines.slice(offset, offset + limit);
			text = sliced.join("\n");

			if (text.length > config.maxOutputLength) {
				text = text.slice(0, config.maxOutputLength) + "\n... (truncated)";
			}

			return { content: text };
		},
	};

	const fileWrite: ToolDefinition = {
		name: "file_write",
		description:
			"Write or append content to a file within the workspace directory.",
		plugin: "kernel",
		input_schema: {
			type: "object",
			properties: {
				path: {
					type: "string",
					description: "File path relative to workspace",
				},
				content: { type: "string", description: "Content to write" },
				append: {
					type: "boolean",
					description: "If true, append instead of overwrite",
				},
			},
			required: ["path", "content"],
		},
		handler: async (input): Promise<ToolResult> => {
			const filePath = safePath(input.path as string, workspace);
			if (!filePath)
				return { content: "Error: path is outside workspace", is_error: true };

			const content = input.content as string;
			if (content.length > config.maxFileSize) {
				return {
					content: `Error: content too large (${content.length} bytes, max ${config.maxFileSize})`,
					is_error: true,
				};
			}

			const file = Bun.file(filePath);
			if (input.append) {
				const existing = existsSync(filePath) ? await file.text() : "";
				await Bun.write(filePath, existing + content);
			} else {
				await Bun.write(filePath, content);
			}

			return { content: `Written ${content.length} bytes to ${input.path}` };
		},
	};

	const fileList: ToolDefinition = {
		name: "file_list",
		description: "List files and directories within the workspace.",
		plugin: "kernel",
		input_schema: {
			type: "object",
			properties: {
				path: {
					type: "string",
					description: "Directory path relative to workspace (default: root)",
				},
				recursive: {
					type: "boolean",
					description: "List recursively (default: false)",
				},
				pattern: {
					type: "string",
					description: "Glob pattern to filter results (e.g. '*.ts')",
				},
			},
		},
		handler: async (input): Promise<ToolResult> => {
			const dirPath = safePath((input.path as string) || ".", workspace);
			if (!dirPath)
				return { content: "Error: path is outside workspace", is_error: true };

			if (!existsSync(dirPath))
				return {
					content: `Error: directory not found: ${input.path || "."}`,
					is_error: true,
				};
			if (!statSync(dirPath).isDirectory())
				return { content: "Error: path is not a directory", is_error: true };

			const entries: string[] = [];
			const pattern = input.pattern as string | undefined;
			const regex = pattern
				? new RegExp(pattern.replace(/\*/g, ".*").replace(/\?/g, "."))
				: null;

			function walk(dir: string, depth: number): void {
				if (entries.length >= 500) return;
				const items = readdirSync(dir, { withFileTypes: true });
				for (const item of items) {
					if (item.name.startsWith(".")) continue;
					const rel = relative(workspace, resolve(dir, item.name));
					if (regex && !regex.test(item.name)) continue;
					const suffix = item.isDirectory() ? "/" : "";
					entries.push(rel + suffix);
					if (item.isDirectory() && input.recursive && depth < 10) {
						walk(resolve(dir, item.name), depth + 1);
					}
				}
			}

			walk(dirPath, 0);

			let output = entries.join("\n");
			if (output.length > config.maxOutputLength) {
				output = output.slice(0, config.maxOutputLength) + "\n... (truncated)";
			}

			return { content: output || "(empty directory)" };
		},
	};

	return [fileRead, fileWrite, fileList];
}
