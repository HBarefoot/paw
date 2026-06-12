import { existsSync, statSync } from "node:fs";
import { basename } from "node:path";
import { safePath } from "../../tools/file-tools.js";
import type { ToolDefinition, ToolResult } from "../../types/message.js";
import type { WordPressClient } from "./client.js";
import type { WordPressContentInput, WordPressContentType } from "./types.js";

export interface WordPressToolDeps {
	/** Records a security-audit entry for write actions (action, details). */
	audit?: (action: string, details: Record<string, unknown>) => void;
	/** Workspace root for the sandboxed media-upload path guard. */
	workspace: string;
	/** Max bytes for an uploaded media file. */
	maxMediaBytes?: number;
}

const DEFAULT_MAX_MEDIA_BYTES = 10 * 1024 * 1024;

/**
 * WordPress tools (posts, pages, media, taxonomies). Grouped under the on-demand
 * `wordpress` skill via `plugin: "wordpress"`. Posts default to draft;
 * publishing/updating/deleting/uploading are audited (publishing is the
 * destructive-class action here). Deletes require an explicit id; media uploads
 * read from a sandboxed workspace path and are size-capped.
 */
export function createWordPressTools(
	client: WordPressClient,
	deps: WordPressToolDeps,
): ToolDefinition[] {
	const audit = deps.audit ?? (() => {});
	const maxMediaBytes = deps.maxMediaBytes ?? DEFAULT_MAX_MEDIA_BYTES;

	async function audited<T>(
		action: string,
		details: Record<string, unknown>,
		fn: () => Promise<T>,
	): Promise<T> {
		try {
			const result = await fn();
			audit(`${action}.ok`, details);
			return result;
		} catch (err) {
			audit(`${action}.fail`, {
				...details,
				error: err instanceof Error ? err.message : String(err),
			});
			throw err;
		}
	}

	const errResult = (err: unknown): ToolResult => ({
		content: `WordPress error: ${err instanceof Error ? err.message : String(err)}`,
		is_error: true,
	});

	const contentInput = (
		input: Record<string, unknown>,
	): WordPressContentInput => ({
		title: input.title as string | undefined,
		content: input.content as string | undefined,
		excerpt: input.excerpt as string | undefined,
		status: input.status as string | undefined,
		slug: input.slug as string | undefined,
		categories: input.categories as number[] | undefined,
		tags: input.tags as number[] | undefined,
	});

	// Build the 5 CRUD tools for a content type (posts | pages).
	function contentCrud(
		type: WordPressContentType,
		noun: "post" | "page",
	): ToolDefinition[] {
		const writeProps = {
			title: { type: "string", description: `${noun} title.` },
			content: { type: "string", description: "HTML/markdown body." },
			excerpt: { type: "string", description: "Optional excerpt." },
			status: {
				type: "string",
				description:
					"draft (default on create), publish, pending, private, or future.",
			},
			slug: { type: "string", description: "Optional URL slug." },
			categories: {
				type: "array",
				items: { type: "number" },
				description: "Category term IDs.",
			},
			tags: {
				type: "array",
				items: { type: "number" },
				description: "Tag term IDs.",
			},
		};

		const create: ToolDefinition = {
			name: `wp_create_${noun}`,
			description: `Create a WordPress ${noun}. Defaults to a draft — set status to "publish" to publish.`,
			plugin: "wordpress",
			input_schema: { type: "object", properties: writeProps },
			handler: async (input): Promise<ToolResult> => {
				try {
					const res = await audited(
						`wordpress.create_${noun}`,
						{ status: input.status ?? "draft" },
						() => client.createContent(type, contentInput(input)),
					);
					return { content: JSON.stringify(res) };
				} catch (err) {
					return errResult(err);
				}
			},
		};

		const update: ToolDefinition = {
			name: `wp_update_${noun}`,
			description: `Update a WordPress ${noun} by id (including publishing via status).`,
			plugin: "wordpress",
			input_schema: {
				type: "object",
				properties: {
					id: { type: "number", description: `${noun} id.` },
					...writeProps,
				},
				required: ["id"],
			},
			handler: async (input): Promise<ToolResult> => {
				const id = input.id as number;
				try {
					const res = await audited(
						`wordpress.update_${noun}`,
						{ id, status: input.status },
						() => client.updateContent(type, id, contentInput(input)),
					);
					return { content: JSON.stringify(res) };
				} catch (err) {
					return errResult(err);
				}
			},
		};

		const get: ToolDefinition = {
			name: `wp_get_${noun}`,
			description: `Fetch a WordPress ${noun} by id.`,
			plugin: "wordpress",
			input_schema: {
				type: "object",
				properties: { id: { type: "number", description: `${noun} id.` } },
				required: ["id"],
			},
			handler: async (input): Promise<ToolResult> => {
				try {
					const res = await client.getContent(type, input.id as number);
					return { content: JSON.stringify(res) };
				} catch (err) {
					return errResult(err);
				}
			},
		};

		const list: ToolDefinition = {
			name: `wp_list_${noun}s`,
			description: `List WordPress ${noun}s, optionally filtered by status and search text.`,
			plugin: "wordpress",
			input_schema: {
				type: "object",
				properties: {
					status: {
						type: "string",
						description: "Filter by status (e.g. publish, draft).",
					},
					search: { type: "string", description: "Search text." },
					perPage: { type: "number", description: "Max results (default 10)." },
				},
			},
			handler: async (input): Promise<ToolResult> => {
				try {
					const res = await client.listContent(type, {
						status: input.status as string | undefined,
						search: input.search as string | undefined,
						perPage: input.perPage as number | undefined,
					});
					return { content: JSON.stringify({ items: res }) };
				} catch (err) {
					return errResult(err);
				}
			},
		};

		const del: ToolDefinition = {
			name: `wp_delete_${noun}`,
			description: `Delete a WordPress ${noun} by id. Requires the explicit id; pass force=true to skip the trash.`,
			plugin: "wordpress",
			input_schema: {
				type: "object",
				properties: {
					id: { type: "number", description: `${noun} id to delete.` },
					force: {
						type: "boolean",
						description: "Permanently delete (skip trash).",
					},
				},
				required: ["id"],
			},
			handler: async (input): Promise<ToolResult> => {
				const id = input.id as number;
				try {
					const res = await audited(`wordpress.delete_${noun}`, { id }, () =>
						client.deleteContent(type, id, (input.force as boolean) ?? false),
					);
					return { content: JSON.stringify(res) };
				} catch (err) {
					return errResult(err);
				}
			},
		};

		return [create, update, get, list, del];
	}

	const uploadMedia: ToolDefinition = {
		name: "wp_upload_media",
		description:
			"Upload a media file to the WordPress media library from a file in the workspace. The path must stay within the workspace and the file must be under the size cap.",
		plugin: "wordpress",
		input_schema: {
			type: "object",
			properties: {
				path: {
					type: "string",
					description: "Workspace-relative path to the file to upload.",
				},
				filename: {
					type: "string",
					description:
						"Optional filename to store as (defaults to the basename).",
				},
			},
			required: ["path"],
		},
		handler: async (input): Promise<ToolResult> => {
			const rel = input.path as string;
			const resolved = safePath(rel, deps.workspace);
			if (!resolved) {
				return {
					content: `WordPress error: path "${rel}" is outside the workspace.`,
					is_error: true,
				};
			}
			if (!existsSync(resolved)) {
				return {
					content: `WordPress error: file not found: ${rel}`,
					is_error: true,
				};
			}
			const stat = statSync(resolved);
			if (stat.isDirectory()) {
				return {
					content: `WordPress error: "${rel}" is a directory.`,
					is_error: true,
				};
			}
			if (stat.size > maxMediaBytes) {
				return {
					content: `WordPress error: file too large (${stat.size} bytes, max ${maxMediaBytes}).`,
					is_error: true,
				};
			}
			const filename =
				(input.filename as string | undefined) ?? basename(resolved);
			try {
				const bytes = await Bun.file(resolved).arrayBuffer();
				const res = await audited(
					"wordpress.upload_media",
					{ filename, bytes: stat.size },
					() => client.uploadMedia(filename, bytes),
				);
				return { content: JSON.stringify(res) };
			} catch (err) {
				return errResult(err);
			}
		},
	};

	const listCategories: ToolDefinition = {
		name: "wp_list_categories",
		description: "List WordPress categories (id, name, slug, count).",
		plugin: "wordpress",
		input_schema: { type: "object", properties: {} },
		handler: async (): Promise<ToolResult> => {
			try {
				return {
					content: JSON.stringify({
						categories: await client.listCategories(),
					}),
				};
			} catch (err) {
				return errResult(err);
			}
		},
	};

	const listTags: ToolDefinition = {
		name: "wp_list_tags",
		description: "List WordPress tags (id, name, slug, count).",
		plugin: "wordpress",
		input_schema: { type: "object", properties: {} },
		handler: async (): Promise<ToolResult> => {
			try {
				return { content: JSON.stringify({ tags: await client.listTags() }) };
			} catch (err) {
				return errResult(err);
			}
		},
	};

	return [
		...contentCrud("posts", "post"),
		...contentCrud("pages", "page"),
		uploadMedia,
		listCategories,
		listTags,
	];
}
