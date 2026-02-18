import Anthropic from "@anthropic-ai/sdk";
import type { MessageParam, ContentBlockParam, ToolUseBlock, ToolResultBlockParam } from "@anthropic-ai/sdk/resources/messages";
import { ToolRegistry } from "./tools.js";
import { DEFAULT_SYSTEM_PROMPT } from "./system-prompt.js";
import type { AIProvider, ChatMessage } from "./base-provider.js";
import type { Logger } from "../types/plugin.js";

export interface ClaudeProviderConfig {
  apiKey: string;
  authMethod: "api_key" | "oauth";
  model: string;
  maxTokens: number;
  maxToolRoundtrips: number;
}

export class ClaudeProvider implements AIProvider {
  readonly name = "claude";
  private client: Anthropic;
  private model: string;
  private maxTokens: number;
  private maxToolRoundtrips: number;
  readonly toolRegistry: ToolRegistry;
  private logger: Logger;

  constructor(config: ClaudeProviderConfig, toolRegistry: ToolRegistry, logger: Logger) {
    if (config.authMethod === "oauth") {
      this.client = new Anthropic({ authToken: config.apiKey, apiKey: null });
    } else {
      this.client = new Anthropic({ apiKey: config.apiKey });
    }

    this.model = config.model;
    this.maxTokens = config.maxTokens;
    this.maxToolRoundtrips = config.maxToolRoundtrips;
    this.toolRegistry = toolRegistry;
    this.logger = logger;

    this.logger.info("Claude provider initialized", { authMethod: config.authMethod, model: config.model });
  }

  private async withRetry<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (err: unknown) {
        lastError = err;
        const isRateLimit =
          (err instanceof Anthropic.RateLimitError) ||
          (err instanceof Error && err.message.includes("429"));
        if (!isRateLimit || attempt === maxRetries) throw err;
        const delayMs = Math.min(1000 * Math.pow(2, attempt), 30000);
        this.logger.warn("Rate limited, retrying", { attempt: attempt + 1, delayMs });
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
    throw lastError;
  }

  async chat(messages: ChatMessage[], systemPrompt?: string): Promise<string> {
    const tools = this.toolRegistry.toAnthropicTools();
    let roundtrips = 0;
    const conversation: MessageParam[] = messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    while (roundtrips < this.maxToolRoundtrips) {
      this.logger.debug("Sending request to Claude", { roundtrip: roundtrips, messageCount: conversation.length });

      const response = await this.withRetry(() =>
        this.client.messages.stream({
          model: this.model,
          max_tokens: this.maxTokens,
          system: systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
          messages: conversation,
          ...(tools.length > 0 ? { tools: tools as Anthropic.Messages.Tool[] } : {}),
        }).finalMessage()
      );

      const toolUseBlocks = response.content.filter((b): b is ToolUseBlock => b.type === "tool_use");

      if (response.stop_reason === "end_turn" || toolUseBlocks.length === 0) {
        const textParts = response.content
          .filter((b) => b.type === "text")
          .map((b) => (b as { type: "text"; text: string }).text);
        return textParts.join("\n");
      }

      conversation.push({ role: "assistant", content: response.content as ContentBlockParam[] });

      const toolResults: ToolResultBlockParam[] = [];
      for (const block of toolUseBlocks) {
        this.logger.info("Executing tool", { tool: block.name, id: block.id });
        const result = await this.toolRegistry.execute(block.name, block.input as Record<string, unknown>);
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: result.content,
          is_error: result.is_error,
        });
      }

      conversation.push({ role: "user", content: toolResults });
      roundtrips++;
    }

    return "I've reached the maximum number of tool-use steps. Here's what I've done so far - please let me know if you'd like me to continue.";
  }
}
