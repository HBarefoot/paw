import type { MemoryStore } from "./store.js";
import type { ToolDefinition } from "../types/message.js";
import { chunkText } from "./chunker.js";

export function createMemoryTools(store: MemoryStore): ToolDefinition[] {
	return [
		{
			name: "memory_store",
			description:
				"Store a fact, preference, decision, or summary in long-term memory. Use this when the user shares important information that should be remembered across sessions.",
			input_schema: {
				type: "object",
				properties: {
					text: { type: "string", description: "The information to remember" },
					category: {
						type: "string",
						enum: ["fact", "preference", "decision", "summary"],
						description:
							"Category: fact (user info), preference (likes/dislikes), decision (choices made), summary (conversation summary)",
					},
					scope: {
						type: "string",
						description: "Scope: 'global' or a user ID. Defaults to 'global'.",
					},
					supersedes: {
						type: "string",
						description:
							"ID of an existing memory this one replaces. The old memory's confidence will be lowered and a supersedes link created.",
					},
				},
				required: ["text", "category"],
			},
			plugin: "kernel",
			handler: async (input) => {
				const text = input.text as string;
				const category = input.category as
					| "fact"
					| "preference"
					| "decision"
					| "summary";
				const scope = (input.scope as string) || "global";
				const supersedes = input.supersedes as string | undefined;

				// Check for potential contradictions before storing
				let warning = "";
				try {
					const candidates =
						await store.findContradictionCandidates(text, { scope });
					if (candidates.length > 0 && !supersedes) {
						const hints = candidates
							.slice(0, 3)
							.map(
								(c) =>
									`  - [${c.metadata.category}] (id: ${c.id}, confidence: ${c.confidence.toFixed(2)}): ${c.text}`,
							)
							.join("\n");
						warning = `\n\nPotential contradictions found. Consider using 'supersedes' to replace:\n${hints}`;
					}
				} catch {
					// Non-critical — store the memory regardless
				}

				const id = await store.store(text, { scope, category }, { supersedes });
				return {
					content: `Memory stored (id: ${id}): "${text}"${warning}`,
				};
			},
		},
		{
			name: "memory_recall",
			description:
				"Search long-term memory for relevant information. Uses both semantic similarity and keyword matching.",
			input_schema: {
				type: "object",
				properties: {
					query: {
						type: "string",
						description: "What to search for in memory",
					},
					limit: {
						type: "number",
						description: "Max results to return (default 5)",
					},
					scope: {
						type: "string",
						description: "Filter by scope ('global' or user ID)",
					},
				},
				required: ["query"],
			},
			plugin: "kernel",
			handler: async (input) => {
				const query = input.query as string;
				const limit = (input.limit as number) || 5;
				const scope = input.scope as string | undefined;
				const results = await store.recall(query, { limit, scope });
				if (results.length === 0) {
					return { content: "No relevant memories found." };
				}
				const lines = results.map(
					(r, i) =>
						`${i + 1}. [${r.metadata.category}] (score: ${r.score.toFixed(2)}, id: ${r.id}): ${r.text}`,
				);
				return {
					content: `Found ${results.length} memories:\n${lines.join("\n")}`,
				};
			},
		},
		{
			name: "memory_forget",
			description:
				"Delete a specific memory by its ID. Use when the user asks you to forget something.",
			input_schema: {
				type: "object",
				properties: {
					memory_id: {
						type: "string",
						description: "The ID of the memory to delete",
					},
				},
				required: ["memory_id"],
			},
			plugin: "kernel",
			handler: async (input) => {
				const memoryId = input.memory_id as string;
				const deleted = store.forget(memoryId);
				return deleted
					? { content: `Memory ${memoryId} deleted.` }
					: { content: `Memory ${memoryId} not found.`, is_error: true };
			},
		},
		{
			name: "import_document",
			description:
				"Chunk a long document and store each chunk as a separate memory. Use this to ingest docs, notes, PDFs, or transcripts so they become retrievable via memory_recall. Each chunk carries the same source metadata for traceability.",
			input_schema: {
				type: "object",
				properties: {
					text: {
						type: "string",
						description: "Full document text to ingest.",
					},
					source: {
						type: "string",
						description:
							"Origin identifier (file name, URL, doc title). Stored on every chunk.",
					},
					scope: {
						type: "string",
						description: "Scope: 'global' or a user ID. Defaults to 'global'.",
					},
					category: {
						type: "string",
						enum: ["fact", "summary"],
						description: "Memory category for all chunks. Defaults to 'fact'.",
					},
				},
				required: ["text", "source"],
			},
			plugin: "kernel",
			handler: async (input) => {
				const text = String(input.text ?? "");
				const source = String(input.source ?? "").trim() || "import";
				const scope = (input.scope as string) || "global";
				const category =
					(input.category as "fact" | "summary") ?? "fact";
				const { chunks, totalChars } = chunkText(text);
				if (chunks.length === 0) {
					return {
						content: "No content to import (empty after normalization).",
						is_error: true,
					};
				}
				const storedIds: string[] = [];
				for (const chunk of chunks) {
					try {
						const id = await store.store(chunk, {
							scope,
							category,
							source,
						});
						storedIds.push(id);
					} catch (err) {
						// Non-fatal — keep going and report the count at the end.
					}
				}
				return {
					content: `Imported ${storedIds.length}/${chunks.length} chunk(s) from "${source}" (${totalChars} chars).`,
				};
			},
		},
	];
}
