import { ToolRegistry } from "./tools.js";
import { DEFAULT_SYSTEM_PROMPT } from "./system-prompt.js";
import { withRetry } from "./retry.js";
import type { AIProvider, ChatMessage, ChatResponse } from "./base-provider.js";
import type { ToolResultImage } from "../types/message.js";
import type { SkillManager } from "./skills.js";
import type { Logger } from "../types/plugin.js";

export interface OllamaProviderConfig {
  baseUrl: string;
  model: string;
  maxToolRoundtrips: number;
}

interface OllamaMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: OllamaToolCall[];
  images?: string[];
}

interface OllamaToolCall {
  function: {
    name: string;
    arguments: Record<string, unknown>;
  };
}

interface OllamaTool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

interface OllamaResponse {
  message: {
    role: string;
    content: string;
    tool_calls?: OllamaToolCall[];
  };
  done: boolean;
}

export class OllamaProvider implements AIProvider {
  readonly name = "ollama";
  private baseUrl: string;
  private model: string;
  private maxToolRoundtrips: number;
  readonly toolRegistry: ToolRegistry;
  private skillManager: SkillManager | null;
  private logger: Logger;

  constructor(config: OllamaProviderConfig, toolRegistry: ToolRegistry, logger: Logger, skillManager?: SkillManager) {
    this.baseUrl = config.baseUrl.replace(/\/$/, "");
    this.model = config.model;
    this.maxToolRoundtrips = config.maxToolRoundtrips;
    this.toolRegistry = toolRegistry;
    this.skillManager = skillManager ?? null;
    this.logger = logger;

    this.logger.info("Ollama provider initialized", { baseUrl: this.baseUrl, model: this.model });
  }

  private getTools(sessionId?: string): OllamaTool[] {
    const raw = (!this.skillManager || !sessionId)
      ? this.toolRegistry.toAnthropicTools()
      : (() => {
          const allowed = this.skillManager.getActiveToolNames(sessionId);
          allowed.add("activate_skill");
          return this.toolRegistry.toAnthropicToolsFiltered(allowed);
        })();

    return raw.map((t) => ({
      type: "function" as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.input_schema,
      },
    }));
  }

  async chat(messages: ChatMessage[], systemPrompt?: string, sessionId?: string): Promise<ChatResponse> {
    let roundtrips = 0;
    const collectedImages: ToolResultImage[] = [];

    const actualSystemPrompt = systemPrompt ?? DEFAULT_SYSTEM_PROMPT;
    const conversation: OllamaMessage[] = [
      { role: "system", content: actualSystemPrompt },
      ...messages.map((m) => {
        const msg: OllamaMessage = { role: m.role as "user" | "assistant", content: m.content };
        if (m.role === "user" && m.attachments && m.attachments.length > 0) {
          msg.images = m.attachments
            .filter((a) => a.type === "image" && a.data)
            .map((a) => a.data!.toString("base64"));
        }
        return msg;
      }),
    ];

    this.logger.debug("Ollama system prompt", {
      fromArg: !!systemPrompt,
      length: actualSystemPrompt.length,
    });

    while (roundtrips < this.maxToolRoundtrips) {
      const tools = this.getTools(sessionId);
      this.logger.debug("Sending request to Ollama", { roundtrip: roundtrips, model: this.model, toolCount: tools.length });

      const body: Record<string, unknown> = {
        model: this.model,
        messages: conversation,
        stream: false,
      };

      if (tools.length > 0) {
        body.tools = tools;
      }

      const data = await withRetry(async () => {
        const res = await fetch(`${this.baseUrl}/api/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });

        if (!res.ok) {
          const text = await res.text();
          throw new Error(`Ollama error (${res.status}): ${text}`);
        }

        return (await res.json()) as OllamaResponse;
      }, this.logger);
      const toolCalls = data.message.tool_calls;

      // No tool calls — return the text response
      if (!toolCalls || toolCalls.length === 0) {
        return {
          text: data.message.content || "",
          images: collectedImages.length > 0 ? collectedImages : undefined,
        };
      }

      // Add assistant message with tool calls
      conversation.push({
        role: "assistant",
        content: data.message.content || "",
        tool_calls: toolCalls,
      });

      // Execute each tool call and add results
      for (const call of toolCalls) {
        if (call.function.name === "activate_skill" && this.skillManager && sessionId) {
          const skillName = call.function.arguments.skill as string;
          const entry = this.skillManager.activateSkill(sessionId, skillName);
          if (entry) {
            this.logger.info("Skill activated", { skill: skillName, tools: entry.toolNames });
            conversation.push({
              role: "tool",
              content: `Skill "${skillName}" activated. You now have access to: ${entry.toolNames.join(", ")}`,
            });
            continue;
          }
        }

        this.logger.info("Executing tool", { tool: call.function.name });
        const result = await this.toolRegistry.execute(call.function.name, call.function.arguments);
        if (result.images) {
          collectedImages.push(...result.images);
        }
        conversation.push({
          role: "tool",
          content: result.content,
        });
      }

      roundtrips++;
    }

    return {
      text: "I've reached the maximum number of tool-use steps. Here's what I've done so far - please let me know if you'd like me to continue.",
      images: collectedImages.length > 0 ? collectedImages : undefined,
    };
  }

  async healthCheck(): Promise<{ ok: boolean; details?: string }> {
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`);
      if (!res.ok) return { ok: false, details: `HTTP ${res.status}` };
      const data = (await res.json()) as { models?: Array<{ name: string }> };
      const models = data.models?.map((m) => m.name) ?? [];
      const hasModel = models.some((m) => m.startsWith(this.model));
      return {
        ok: true,
        details: hasModel
          ? `Connected, model "${this.model}" available`
          : `Connected, but model "${this.model}" not found. Available: ${models.join(", ")}`,
      };
    } catch (err) {
      return { ok: false, details: `Cannot reach Ollama at ${this.baseUrl}: ${err}` };
    }
  }
}
