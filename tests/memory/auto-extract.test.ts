import { describe, test, expect, mock } from "bun:test";
import { extractMemories } from "../../src/memory/auto-extract.js";
import type { AIProvider, ChatMessage } from "../../src/ai/base-provider.js";

function mockProvider(response: string): AIProvider {
  return {
    chat: mock(() => Promise.resolve(response)),
  } as unknown as AIProvider;
}

describe("extractMemories", () => {
  test("returns empty array for empty messages", async () => {
    const provider = mockProvider("");
    const result = await extractMemories(provider, []);
    expect(result).toEqual([]);
  });

  test("keeps plain sentences from AI response", async () => {
    const provider = mockProvider(
      "User prefers dark mode\nUser's name is Alice\nUser works at Acme Corp",
    );
    const messages: ChatMessage[] = [
      { role: "user", content: "I'm Alice from Acme Corp, I like dark mode" },
    ];
    const result = await extractMemories(provider, messages);
    expect(result.length).toBe(3);
    expect(result).toContain("User prefers dark mode");
    expect(result).toContain("User's name is Alice");
    expect(result).toContain("User works at Acme Corp");
  });

  test("filters out NONE responses", async () => {
    const provider = mockProvider("NONE");
    const messages: ChatMessage[] = [
      { role: "user", content: "hello" },
    ];
    const result = await extractMemories(provider, messages);
    expect(result).toEqual([]);
  });

  test("filters out case-insensitive NONE", async () => {
    const provider = mockProvider("none");
    const messages: ChatMessage[] = [
      { role: "user", content: "hi" },
    ];
    const result = await extractMemories(provider, messages);
    expect(result).toEqual([]);
  });

  test("strips leading dashes and bullets from lines", async () => {
    const provider = mockProvider(
      "- User prefers TypeScript\n* User uses Bun runtime",
    );
    const messages: ChatMessage[] = [
      { role: "user", content: "I use TypeScript with Bun" },
    ];
    const result = await extractMemories(provider, messages);
    expect(result).toContain("User prefers TypeScript");
    expect(result).toContain("User uses Bun runtime");
  });

  test("filters out very short fragments", async () => {
    const provider = mockProvider("Yes\nUser prefers dark mode");
    const messages: ChatMessage[] = [
      { role: "user", content: "I like dark mode" },
    ];
    const result = await extractMemories(provider, messages);
    expect(result).toEqual(["User prefers dark mode"]);
  });
});
