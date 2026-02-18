import type { ToolRegistry } from "./tools.js";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface AIProvider {
  readonly name: string;
  readonly toolRegistry: ToolRegistry;
  chat(messages: ChatMessage[], systemPrompt?: string): Promise<string>;
}
