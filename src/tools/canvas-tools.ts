import type { Database } from "bun:sqlite";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	realpathSync,
	renameSync,
	rmSync,
	statSync,
} from "node:fs";
import { dirname, relative, resolve } from "node:path";
import type { ToolDefinition, ToolResult } from "../types/message.js";
import { safePath, writeCanvasFile } from "./canvas-write.js";

interface CanvasToolsConfig {
	canvasRoot: string;
	database?: Database;
}

export function createCanvasTools(config: CanvasToolsConfig): ToolDefinition[] {
	const root = resolve(config.canvasRoot);

	const canvasWrite: ToolDefinition = {
		name: "canvas_write",
		description:
			"Write a file to the canvas workspace. Creates parent directories automatically. Use this to create HTML, CSS, and JS files for the live preview.",
		plugin: "kernel",
		input_schema: {
			type: "object",
			properties: {
				path: {
					type: "string",
					description:
						"File path relative to canvas root (e.g. 'index.html', 'css/style.css')",
				},
				content: { type: "string", description: "File content to write" },
			},
			required: ["path", "content"],
		},
		handler: async (input): Promise<ToolResult> => {
			const res = await writeCanvasFile({
				root,
				relPath: input.path as string,
				content: input.content as string,
				db: config.database,
			});
			if (!res.ok) {
				return { content: `Error writing file: ${res.error}`, is_error: true };
			}
			return { content: JSON.stringify({ written: true, path: res.path }) };
		},
	};

	const canvasRead: ToolDefinition = {
		name: "canvas_read",
		description: "Read a file from the canvas workspace.",
		plugin: "kernel",
		input_schema: {
			type: "object",
			properties: {
				path: {
					type: "string",
					description: "File path relative to canvas root",
				},
			},
			required: ["path"],
		},
		handler: async (input): Promise<ToolResult> => {
			const filePath = safePath(input.path as string, root);
			if (!filePath)
				return {
					content: "Error: path is outside canvas root",
					is_error: true,
				};

			if (!existsSync(filePath))
				return {
					content: `Error: file not found: ${input.path}`,
					is_error: true,
				};

			const stat = statSync(filePath);
			if (stat.isDirectory())
				return {
					content: "Error: path is a directory, use canvas_list instead",
					is_error: true,
				};

			const file = Bun.file(filePath);
			return { content: await file.text() };
		},
	};

	const canvasList: ToolDefinition = {
		name: "canvas_list",
		description: "List files in the canvas workspace with sizes.",
		plugin: "kernel",
		input_schema: {
			type: "object",
			properties: {
				pattern: {
					type: "string",
					description: "Glob-style pattern to filter (e.g. '*.html')",
				},
			},
		},
		handler: async (input): Promise<ToolResult> => {
			if (!existsSync(root)) return { content: "(empty canvas)" };

			const entries: string[] = [];
			const pattern = input.pattern as string | undefined;
			const regex = pattern
				? new RegExp(pattern.replace(/\*/g, ".*").replace(/\?/g, "."))
				: null;

			function walk(dir: string, depth: number): void {
				if (entries.length >= 500 || depth > 10) return;
				const items = readdirSync(dir, { withFileTypes: true });
				for (const item of items) {
					if (item.name.startsWith(".")) continue;
					const fullPath = resolve(dir, item.name);
					const rel = relative(root, fullPath);
					if (regex && !regex.test(item.name)) continue;
					if (item.isDirectory()) {
						entries.push(`${rel}/`);
						walk(fullPath, depth + 1);
					} else {
						const size = statSync(fullPath).size;
						entries.push(`${rel} (${size}b)`);
					}
				}
			}

			walk(root, 0);
			return { content: entries.join("\n") || "(empty canvas)" };
		},
	};

	const canvasMkdir: ToolDefinition = {
		name: "canvas_mkdir",
		description:
			"Create a folder in the canvas workspace. Use to organize canvases by department/operation (e.g. 'sales-campaign', 'cms/blog'). Creates parent folders automatically.",
		plugin: "kernel",
		input_schema: {
			type: "object",
			properties: {
				path: {
					type: "string",
					description:
						"Folder path relative to canvas root (e.g. 'sales-campaign')",
				},
			},
			required: ["path"],
		},
		handler: async (input): Promise<ToolResult> => {
			const rel = (input.path as string)?.trim();
			if (!rel || rel === "." || rel === "/")
				return { content: "Error: invalid folder path", is_error: true };
			const dirPath = safePath(rel, root);
			if (!dirPath)
				return {
					content: "Error: path is outside canvas root",
					is_error: true,
				};
			mkdirSync(dirPath, { recursive: true });
			return { content: JSON.stringify({ created: true, path: rel }) };
		},
	};

	const canvasDelete: ToolDefinition = {
		name: "canvas_delete",
		description:
			"Delete a file or folder (recursively) from the canvas workspace. Use with care — this is permanent.",
		plugin: "kernel",
		input_schema: {
			type: "object",
			properties: {
				path: {
					type: "string",
					description: "File or folder path relative to canvas root",
				},
			},
			required: ["path"],
		},
		handler: async (input): Promise<ToolResult> => {
			const rel = (input.path as string)?.trim();
			// Refuse empty/root deletes that would wipe the whole workspace.
			if (!rel || rel === "." || rel === "/" || rel === "./")
				return {
					content: "Error: refusing to delete the canvas root",
					is_error: true,
				};
			const target = safePath(rel, root);
			if (!target)
				return {
					content: "Error: path is outside canvas root",
					is_error: true,
				};
			if (resolve(target) === root)
				return {
					content: "Error: refusing to delete the canvas root",
					is_error: true,
				};
			if (!existsSync(target))
				return { content: `Error: not found: ${rel}`, is_error: true };
			rmSync(target, { recursive: true, force: true });
			return { content: JSON.stringify({ deleted: true, path: rel }) };
		},
	};

	const canvasMove: ToolDefinition = {
		name: "canvas_move",
		description:
			"Move or rename a file or folder within the canvas workspace (e.g. move 'index.html' into 'sales-campaign/index.html').",
		plugin: "kernel",
		input_schema: {
			type: "object",
			properties: {
				from: {
					type: "string",
					description: "Current path relative to canvas root",
				},
				to: {
					type: "string",
					description: "Destination path relative to canvas root",
				},
			},
			required: ["from", "to"],
		},
		handler: async (input): Promise<ToolResult> => {
			const fromRel = (input.from as string)?.trim();
			const toRel = (input.to as string)?.trim();
			if (!fromRel || !toRel)
				return {
					content: "Error: 'from' and 'to' are required",
					is_error: true,
				};
			const fromPath = safePath(fromRel, root);
			const toPath = safePath(toRel, root);
			if (!fromPath || !toPath)
				return {
					content: "Error: path is outside canvas root",
					is_error: true,
				};
			if (!existsSync(fromPath))
				return { content: `Error: not found: ${fromRel}`, is_error: true };
			if (existsSync(toPath))
				return {
					content: `Error: destination exists: ${toRel}`,
					is_error: true,
				};
			mkdirSync(dirname(toPath), { recursive: true });
			renameSync(fromPath, toPath);
			return {
				content: JSON.stringify({ moved: true, from: fromRel, to: toRel }),
			};
		},
	};

	return [
		canvasWrite,
		canvasRead,
		canvasList,
		canvasMkdir,
		canvasDelete,
		canvasMove,
	];
}
