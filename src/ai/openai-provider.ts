import { ToolRegistry } from "./tools.js";
import { DEFAULT_SYSTEM_PROMPT } from "./system-prompt.js";
import type { AIProvider, ChatMessage } from "./base-provider.js";
import type { Logger } from "../types/plugin.js";

export interface OpenAIProviderConfig {
  apiKey: string;
  model: string;
  maxTokens: number;
  maxToolRoundtrips: number;
  baseUrl?: string;
}

interface OpenAIMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
}

interface OpenAIToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

interface OpenAITool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

interface OpenAIResponse {
  choices: Array<{
    message: {
      role: string;
      content: string | null;
      tool_calls?: OpenAIToolCall[];
    };
    finish_reason: string;
  }>;
}

export class OpenAIProvider implements AIProvider {
  readonly name = "openai";
  private apiKey: string;
  private model: string;
  private maxTokens: number;
  private maxToolRoundtrips: number;
  private baseUrl: string;
  readonly toolRegistry: ToolRegistry;
  private logger: Logger;

  constructor(config: OpenAIProviderConfig, toolRegistry: ToolRegistry, logger: Logger) {
    this.apiKey = config.apiKey;
    this.model = config.model;
    this.maxTokens = config.maxTokens;
    this.maxToolRoundtrips = config.maxToolRoundtrips;
    this.baseUrl = (config.baseUrl ?? "https://api.openai.com/v1").replace(/\/$/, "");
    this.toolRegistry = toolRegistry;
    this.logger = logger;

    this.logger.info("OpenAI provider initialized", { model: this.model, baseUrl: this.baseUrl });
  }

  async chat(messages: ChatMessage[], systemPrompt?: string): Promise<string> {
    const tools = this.buildTools();
    let roundtrips = 0;

    const conversation: OpenAIMessage[] = [
      { role: "system", content: systemPrompt ?? DEFAULT_SYSTEM_PROMPT },
      ...messages.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
    ];

    while (roundtrips < this.maxToolRoundtrips) {
      this.logger.debug("Sending request to OpenAI", { roundtrip: roundtrips, model: this.model });

      const body: Record<string, unknown> = {
        model: this.model,
        messages: conversation,
        max_tokens: this.maxTokens,
      };

      if (tools.length > 0) {
        body.tools = tools;
      }

      const res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`OpenAI error (${res.status}): ${text}`);
      }

      const data = (await res.json()) as OpenAIResponse;
      const choice = data.choices[0];
      if (!choice) throw new Error("OpenAI returned no choices");

      const toolCalls = choice.message.tool_calls;

      // No tool calls — return text response
      if (!toolCalls || toolCalls.length === 0 || choice.finish_reason === "stop") {
        return choice.message.content ?? "";
      }

      // Add assistant message with tool calls
      conversation.push({
        role: "assistant",
        content: choice.message.content,
        tool_calls: toolCalls,
      });

      // Execute each tool call and add results
      for (const call of toolCalls) {
        this.logger.info("Executing tool", { tool: call.function.name, id: call.id });
        let args: Record<string, unknown>;
        try {
          args = JSON.parse(call.function.arguments);
        } catch {
          args = {};
        }
        const result = await this.toolRegistry.execute(call.function.name, args);
        conversation.push({
          role: "tool",
          content: result.content,
          tool_call_id: call.id,
        });
      }

      roundtrips++;
    }

    return "I've reached the maximum number of tool-use steps. Here's what I've done so far - please let me know if you'd like me to continue.";
  }

  private buildTools(): OpenAITool[] {
    return this.toolRegistry.toAnthropicTools().map((t) => ({
      type: "function" as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.input_schema,
      },
    }));
  }
}
