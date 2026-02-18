import type { MemoryStore } from "./store.js";
import type { ToolDefinition } from "../types/message.js";

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
        },
        required: ["text", "category"],
      },
      plugin: "kernel",
      handler: async (input) => {
        const text = input.text as string;
        const category = input.category as "fact" | "preference" | "decision" | "summary";
        const scope = (input.scope as string) || "global";
        const id = await store.store(text, { scope, category });
        return { content: `Memory stored (id: ${id}): "${text}"` };
      },
    },
    {
      name: "memory_recall",
      description:
        "Search long-term memory for relevant information. Uses both semantic similarity and keyword matching.",
      input_schema: {
        type: "object",
        properties: {
          query: { type: "string", description: "What to search for in memory" },
          limit: { type: "number", description: "Max results to return (default 5)" },
          scope: { type: "string", description: "Filter by scope ('global' or user ID)" },
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
        return { content: `Found ${results.length} memories:\n${lines.join("\n")}` };
      },
    },
    {
      name: "memory_forget",
      description: "Delete a specific memory by its ID. Use when the user asks you to forget something.",
      input_schema: {
        type: "object",
        properties: {
          memory_id: { type: "string", description: "The ID of the memory to delete" },
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
  ];
}
