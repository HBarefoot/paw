import type { ToolDefinition, ToolResult } from "../../types/message.js";
import type { StrapiClient } from "./client.js";

/** Safely unpack a Strapi entry regardless of format (v4 wrapped vs flat). */
function flattenEntry(entry: unknown): Record<string, unknown> {
	if (typeof entry !== "object" || entry === null) return { _raw: entry };
	const e = entry as Record<string, unknown>;
	if ("id" in e && "attributes" in e) {
		return { id: e.id, documentId: e.documentId, ...(e.attributes as Record<string, unknown>) };
	}
	return e; // already flat — v5 entries include documentId natively
}

/** Convert a Strapi UID like "api::blog-post.blog-post" to "Blog Post". */
function humanize(uid: string): string {
	const name = uid.split(".").pop() ?? uid;
	return name
		.replace(/-/g, " ")
		.replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Naive English pluralization for Strapi content-type slugs. */
function naivePlural(word: string): string {
	if (word.endsWith("s") || word.endsWith("es")) return word;
	if (/[^aeiou]y$/i.test(word)) return `${word.slice(0, -1)}ies`;
	if (/(?:s|sh|ch|x|z)$/i.test(word)) return `${word}es`;
	return `${word}s`;
}

/** Safely extract entries from a Strapi list response of any shape. */
function extractList(body: unknown): { entries: unknown[]; pagination?: unknown } {
	if (typeof body !== "object" || body === null) return { entries: [body] };
	const b = body as Record<string, unknown>;

	// Standard v4: { data: [...], meta: { pagination } }
	if (Array.isArray(b.data)) {
		return {
			entries: b.data.map(flattenEntry),
			pagination: (b.meta as Record<string, unknown>)?.pagination,
		};
	}

	// Flat array response (e.g. /api/users)
	if (Array.isArray(body)) {
		return { entries: (body as unknown[]).map(flattenEntry) };
	}

	// Single-object data wrapper
	if (b.data && typeof b.data === "object") {
		return { entries: [flattenEntry(b.data)] };
	}

	// Unknown shape — return raw
	return { entries: [b] };
}

/** Safely extract a single entry from a Strapi item response. */
function extractItem(body: unknown): Record<string, unknown> {
	if (typeof body !== "object" || body === null) return { _raw: body };
	const b = body as Record<string, unknown>;
	if (b.data && typeof b.data === "object") return flattenEntry(b.data);
	return flattenEntry(b);
}

export function createStrapiTools(client: StrapiClient): ToolDefinition[] {
	const strapiList: ToolDefinition = {
		name: "strapi_list",
		description:
			"List content entries from Strapi CMS. Use this to retrieve blog posts, pages, or any content type. Returns entries with pagination info.",
		plugin: "strapi",
		input_schema: {
			type: "object",
			properties: {
				contentType: {
					type: "string",
					description:
						'The Strapi content type slug (e.g. "articles", "pages")',
				},
				filters: {
					type: "object",
					description: "Optional Strapi filter object",
				},
				sort: {
					type: "string",
					description:
						'Sort field and direction (e.g. "createdAt:desc")',
				},
				fields: {
					type: "array",
					items: { type: "string" },
					description: "Fields to include in response",
				},
				populate: {
					type: "string",
					description:
						'Relations to populate (e.g. "*" for all, or a specific relation name)',
				},
				page: {
					type: "number",
					description: "Page number (default: 1)",
				},
				pageSize: {
					type: "number",
					description: "Results per page (default: 25)",
				},
			},
			required: ["contentType"],
		},
		handler: async (input): Promise<ToolResult> => {
			try {
				const result = await client.find(input.contentType as string, {
					filters: input.filters as Record<string, unknown> | undefined,
					sort: input.sort as string | undefined,
					fields: input.fields as string[] | undefined,
					populate: input.populate as string | undefined,
					pagination: {
						page: (input.page as number) ?? 1,
						pageSize: (input.pageSize as number) ?? 25,
					},
				});
				const { entries, pagination } = extractList(result);
				return {
					content: JSON.stringify({ entries, pagination }),
				};
			} catch (err) {
				return { content: `Strapi error: ${err}`, is_error: true };
			}
		},
	};

	const strapiGet: ToolDefinition = {
		name: "strapi_get",
		description:
			"Get a single content entry from Strapi CMS by content type and ID.",
		plugin: "strapi",
		input_schema: {
			type: "object",
			properties: {
				contentType: {
					type: "string",
					description: "The Strapi content type slug",
				},
				documentId: {
					type: "string",
					description:
						"The document ID of the entry (e.g. 'jfzhd1tb26p02tqkeyvp7ykq')",
				},
				populate: {
					type: "string",
					description: "Relations to populate",
				},
				fields: {
					type: "array",
					items: { type: "string" },
					description: "Fields to include",
				},
			},
			required: ["contentType", "documentId"],
		},
		handler: async (input): Promise<ToolResult> => {
			try {
				const result = await client.findOne(
					input.contentType as string,
					input.documentId as string,
					{
						populate: input.populate as string | undefined,
						fields: input.fields as string[] | undefined,
					},
				);
				return { content: JSON.stringify(extractItem(result)) };
			} catch (err) {
				return { content: `Strapi error: ${err}`, is_error: true };
			}
		},
	};

	const strapiCreate: ToolDefinition = {
		name: "strapi_create",
		description:
			"Create a new content entry in Strapi CMS. Provide the content type and data fields.",
		plugin: "strapi",
		input_schema: {
			type: "object",
			properties: {
				contentType: {
					type: "string",
					description: "The Strapi content type slug",
				},
				data: {
					type: "object",
					description: "The entry data (field values)",
				},
			},
			required: ["contentType", "data"],
		},
		handler: async (input): Promise<ToolResult> => {
			try {
				const result = await client.create(
					input.contentType as string,
					input.data as Record<string, unknown>,
				);
				return { content: JSON.stringify(extractItem(result)) };
			} catch (err) {
				return { content: `Strapi error: ${err}`, is_error: true };
			}
		},
	};

	const strapiUpdate: ToolDefinition = {
		name: "strapi_update",
		description:
			"Update an existing content entry in Strapi CMS by content type and ID.",
		plugin: "strapi",
		input_schema: {
			type: "object",
			properties: {
				contentType: {
					type: "string",
					description: "The Strapi content type slug",
				},
				documentId: {
					type: "string",
					description: "The document ID of the entry to update",
				},
				data: {
					type: "object",
					description: "The fields to update",
				},
			},
			required: ["contentType", "documentId", "data"],
		},
		handler: async (input): Promise<ToolResult> => {
			try {
				const result = await client.update(
					input.contentType as string,
					input.documentId as string,
					input.data as Record<string, unknown>,
				);
				return { content: JSON.stringify(extractItem(result)) };
			} catch (err) {
				return { content: `Strapi error: ${err}`, is_error: true };
			}
		},
	};

	const strapiContentTypes: ToolDefinition = {
		name: "strapi_content_types",
		description:
			"List all available content types in Strapi CMS. Use this first to discover what content types exist before trying to list or create entries.",
		plugin: "strapi",
		input_schema: {
			type: "object",
			properties: {},
		},
		handler: async (): Promise<ToolResult> => {
			try {
				const result = await client.getContentTypes();
				const body = result as Record<string, unknown>;
				const raw = Array.isArray(body.data) ? body.data : [];

				const types = raw
					.filter((ct: Record<string, unknown>) => {
						const uid = ct.uid as string;
						return uid?.startsWith("api::");
					})
					.map((ct: Record<string, unknown>) => {
						const uid = ct.uid as string;
						const info = ct.info as Record<string, unknown> | undefined;
						const displayName =
							(info?.displayName as string) || humanize(uid);
						const rawPlural =
							(info?.pluralName as string) ??
							uid.split(".").pop() ??
							uid;
						const pluralName = naivePlural(rawPlural);
						return {
							uid,
							displayName,
							pluralName,
							singularName: info?.singularName,
						};
					});

				return {
					content: JSON.stringify({
						contentTypes: types,
						hint: "Use the pluralName as the contentType parameter in other strapi tools.",
					}),
				};
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				if (msg.includes("403")) {
					return {
						content:
							"Cannot list content types: 403 Forbidden. The API token may not have access to the content-type-builder API. Use a Full Access token.",
						is_error: true,
					};
				}
				return { content: `Strapi error: ${err}`, is_error: true };
			}
		},
	};

	return [strapiList, strapiGet, strapiCreate, strapiUpdate, strapiContentTypes];
}
