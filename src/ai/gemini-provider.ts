import { ToolRegistry } from "./tools.js";
import { DEFAULT_SYSTEM_PROMPT } from "./system-prompt.js";
import type { AIProvider, ChatMessage } from "./base-provider.js";
import type { SkillManager } from "./skills.js";
import type { Logger } from "../types/plugin.js";

export interface GeminiProviderConfig {
  apiKey: string;
  model: string;
  maxTokens: number;
  maxToolRoundtrips: number;
}

interface GeminiContent {
  role: "user" | "model";
  parts: GeminiPart[];
}

type GeminiPart =
  | { text: string }
  | { functionCall: { name: string; args: Record<string, unknown> } }
  | { functionResponse: { name: string; response: { content: string } } };

interface GeminiTool {
  functionDeclarations: Array<{
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  }>;
}

interface GeminiResponse {
  candidates: Array<{
    content: { role: string; parts: GeminiPart[] };
    finishReason: string;
  }>;
}

export class GeminiProvider implements AIProvider {
  readonly name = "gemini";
  private apiKey: string;
  private model: string;
  private maxTokens: number;
  private maxToolRoundtrips: number;
  readonly toolRegistry: ToolRegistry;
  private skillManager: SkillManager | null;
  private logger: Logger;

  constructor(config: GeminiProviderConfig, toolRegistry: ToolRegistry, logger: Logger, skillManager?: SkillManager) {
    this.apiKey = config.apiKey;
    this.model = config.model;
    this.maxTokens = config.maxTokens;
    this.maxToolRoundtrips = config.maxToolRoundtrips;
    this.toolRegistry = toolRegistry;
    this.skillManager = skillManager ?? null;
    this.logger = logger;

    this.logger.info("Gemini provider initialized", { model: this.model });
  }

  private getTools(sessionId?: string): GeminiTool[] {
    const raw = (!this.skillManager || !sessionId)
      ? this.toolRegistry.toAnthropicTools()
      : (() => {
          const allowed = this.skillManager.getActiveToolNames(sessionId);
          allowed.add("activate_skill");
          return this.toolRegistry.toAnthropicToolsFiltered(allowed);
        })();

    const declarations = raw.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.input_schema,
    }));

    if (declarations.length === 0) return [];
    return [{ functionDeclarations: declarations }];
  }

  async chat(messages: ChatMessage[], systemPrompt?: string, sessionId?: string): Promise<string> {
    let roundtrips = 0;

    const contents: GeminiContent[] = messages.map((m) => ({
      role: m.role === "assistant" ? "model" as const : "user" as const,
      parts: [{ text: m.content }],
    }));

    while (roundtrips < this.maxToolRoundtrips) {
      const tools = this.getTools(sessionId);
      this.logger.debug("Sending request to Gemini", { roundtrip: roundtrips, model: this.model });

      const body: Record<string, unknown> = {
        contents,
        generationConfig: {
          maxOutputTokens: this.maxTokens,
        },
      };

      if (systemPrompt ?? DEFAULT_SYSTEM_PROMPT) {
        body.systemInstruction = {
          parts: [{ text: systemPrompt ?? DEFAULT_SYSTEM_PROMPT }],
        };
      }

      if (tools.length > 0) {
        body.tools = tools;
      }

      const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;

      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Gemini error (${res.status}): ${text}`);
      }

      const data = (await res.json()) as GeminiResponse;
      const candidate = data.candidates?.[0];
      if (!candidate) throw new Error("Gemini returned no candidates");

      const parts = candidate.content.parts;
      const functionCalls = parts.filter(
        (p): p is { functionCall: { name: string; args: Record<string, unknown> } } =>
          "functionCall" in p,
      );

      // No function calls — return text
      if (functionCalls.length === 0) {
        const textParts = parts
          .filter((p): p is { text: string } => "text" in p)
          .map((p) => p.text);
        return textParts.join("\n");
      }

      // Add model response to conversation
      contents.push({ role: "model", parts });

      // Execute function calls and add results
      const responseParts: GeminiPart[] = [];
      for (const call of functionCalls) {
        if (call.functionCall.name === "activate_skill" && this.skillManager && sessionId) {
          const skillName = call.functionCall.args.skill as string;
          const entry = this.skillManager.activateSkill(sessionId, skillName);
          if (entry) {
            this.logger.info("Skill activated", { skill: skillName, tools: entry.toolNames });
            responseParts.push({
              functionResponse: {
                name: call.functionCall.name,
                response: { content: `Skill "${skillName}" activated. You now have access to: ${entry.toolNames.join(", ")}` },
              },
            });
            continue;
          }
        }

        this.logger.info("Executing tool", { tool: call.functionCall.name });
        const result = await this.toolRegistry.execute(
          call.functionCall.name,
          call.functionCall.args,
        );
        responseParts.push({
          functionResponse: {
            name: call.functionCall.name,
            response: { content: result.content },
          },
        });
      }

      contents.push({ role: "user", parts: responseParts });
      roundtrips++;
    }

    return "I've reached the maximum number of tool-use steps. Here's what I've done so far - please let me know if you'd like me to continue.";
  }
}
