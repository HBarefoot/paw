import Anthropic from "@anthropic-ai/sdk";
import type { MessageParam, ContentBlockParam, ToolUseBlock, ToolResultBlockParam } from "@anthropic-ai/sdk/resources/messages";
import { ToolRegistry } from "./tools.js";
import { DEFAULT_SYSTEM_PROMPT } from "./system-prompt.js";
import { withRetry } from "./retry.js";
import type { AIProvider, ChatMessage, ChatResponse } from "./base-provider.js";
import type { ToolResultImage } from "../types/message.js";
import type { SkillManager } from "./skills.js";
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
  private skillManager: SkillManager | null;
  private logger: Logger;

  constructor(config: ClaudeProviderConfig, toolRegistry: ToolRegistry, logger: Logger, skillManager?: SkillManager) {
    if (config.authMethod === "oauth") {
      this.client = new Anthropic({ authToken: config.apiKey, apiKey: null });
    } else {
      this.client = new Anthropic({ apiKey: config.apiKey });
    }

    this.model = config.model;
    this.maxTokens = config.maxTokens;
    this.maxToolRoundtrips = config.maxToolRoundtrips;
    this.toolRegistry = toolRegistry;
    this.skillManager = skillManager ?? null;
    this.logger = logger;

    this.logger.info("Claude provider initialized", { authMethod: config.authMethod, model: config.model });
  }

  private getTools(sessionId?: string) {
    if (!this.skillManager || !sessionId) {
      return this.toolRegistry.toAnthropicTools();
    }
    const allowed = this.skillManager.getActiveToolNames(sessionId);
    allowed.add("activate_skill");
    return this.toolRegistry.toAnthropicToolsFiltered(allowed);
  }

  async chat(messages: ChatMessage[], systemPrompt?: string, sessionId?: string): Promise<ChatResponse> {
    let roundtrips = 0;
    const collectedImages: ToolResultImage[] = [];
    const conversation: MessageParam[] = messages.map((m) => {
      if (m.role === "user" && m.attachments && m.attachments.length > 0) {
        const contentParts: ContentBlockParam[] = [];
        for (const att of m.attachments) {
          if (att.type === "image" && att.data && att.mimeType) {
            contentParts.push({
              type: "image",
              source: {
                type: "base64",
                media_type: att.mimeType as "image/png" | "image/jpeg" | "image/gif" | "image/webp",
                data: att.data.toString("base64"),
              },
            } as ContentBlockParam);
          } else if (att.type === "text" && att.data) {
            const header = att.name ? `[File: ${att.name}]\n` : "";
            contentParts.push({ type: "text", text: header + att.data.toString("utf-8") } as ContentBlockParam);
          }
        }
        contentParts.push({ type: "text", text: m.content } as ContentBlockParam);
        return { role: m.role, content: contentParts };
      }
      return { role: m.role, content: m.content };
    });

    while (roundtrips < this.maxToolRoundtrips) {
      const tools = this.getTools(sessionId);
      this.logger.debug("Sending request to Claude", { roundtrip: roundtrips, messageCount: conversation.length, toolCount: tools.length });

      const response = await withRetry(() =>
        this.client.messages.stream({
          model: this.model,
          max_tokens: this.maxTokens,
          system: systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
          messages: conversation,
          ...(tools.length > 0 ? { tools: tools as Anthropic.Messages.Tool[] } : {}),
        }).finalMessage()
      , this.logger);

      const toolUseBlocks = response.content.filter((b): b is ToolUseBlock => b.type === "tool_use");

      if (response.stop_reason === "end_turn" || toolUseBlocks.length === 0) {
        const textParts = response.content
          .filter((b) => b.type === "text")
          .map((b) => (b as { type: "text"; text: string }).text);
        return {
          text: textParts.join("\n"),
          images: collectedImages.length > 0 ? collectedImages : undefined,
        };
      }

      conversation.push({ role: "assistant", content: response.content as ContentBlockParam[] });

      const toolResults: ToolResultBlockParam[] = [];
      for (const block of toolUseBlocks) {
        if (block.name === "activate_skill" && this.skillManager && sessionId) {
          const skillName = (block.input as Record<string, unknown>).skill as string;
          const entry = this.skillManager.activateSkill(sessionId, skillName);
          if (entry) {
            this.logger.info("Skill activated", { skill: skillName, tools: entry.toolNames });
            toolResults.push({
              type: "tool_result",
              tool_use_id: block.id,
              content: `Skill "${skillName}" activated. You now have access to: ${entry.toolNames.join(", ")}`,
            });
            continue;
          }
        }

        this.logger.info("Executing tool", { tool: block.name, id: block.id });
        const result = await this.toolRegistry.execute(block.name, block.input as Record<string, unknown>);

        if (result.images && result.images.length > 0) {
          collectedImages.push(...result.images);
          // Build a multi-part content array with text + image blocks
          const contentParts: Array<
            | { type: "text"; text: string }
            | { type: "image"; source: { type: "base64"; media_type: string; data: string } }
          > = [];
          if (result.content) {
            contentParts.push({ type: "text", text: result.content });
          }
          for (const img of result.images) {
            contentParts.push({
              type: "image",
              source: { type: "base64", media_type: img.media_type, data: img.base64 },
            });
          }
          toolResults.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: contentParts as any,
            is_error: result.is_error,
          });
        } else {
          toolResults.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: result.content,
            is_error: result.is_error,
          });
        }
      }

      conversation.push({ role: "user", content: toolResults });
      roundtrips++;
    }

    return {
      text: "I've reached the maximum number of tool-use steps. Here's what I've done so far - please let me know if you'd like me to continue.",
      images: collectedImages.length > 0 ? collectedImages : undefined,
    };
  }
}
