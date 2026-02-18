import type { Sandbox } from "../kernel/sandbox.js";
import type { ToolDefinition, ToolResult } from "../types/message.js";

export class ToolRegistry {
  private tools = new Map<string, ToolDefinition>();
  private sandbox: Sandbox | null = null;
  private enforcePermissions = false;

  register(tools: ToolDefinition[]): void {
    for (const tool of tools) {
      if (this.tools.has(tool.name)) {
        throw new Error(`Tool "${tool.name}" is already registered`);
      }
      this.tools.set(tool.name, tool);
    }
  }

  setSandbox(sandbox: Sandbox, enforce = true): void {
    this.sandbox = sandbox;
    this.enforcePermissions = enforce;
  }

  unregisterPlugin(pluginName: string): void {
    for (const [name, tool] of this.tools) {
      if (tool.plugin === pluginName) {
        this.tools.delete(name);
      }
    }
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  async execute(name: string, input: Record<string, unknown>): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return { content: `Unknown tool: ${name}`, is_error: true };
    }

    // Sandbox permission check
    if (this.sandbox && this.enforcePermissions && tool.plugin !== "kernel") {
      const permitted = this.sandbox.checkPermission(tool.plugin, this.inferPermission(tool));
      if (!permitted) {
        return { content: `Permission denied: ${tool.plugin} cannot use ${name}`, is_error: true };
      }
    }

    try {
      return await tool.handler(input);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: `Tool error: ${msg}`, is_error: true };
    }
  }

  private inferPermission(tool: ToolDefinition): string {
    // Infer required permission from tool name prefix
    if (tool.name.startsWith("mcp__")) return tool.plugin; // mcp:<server>
    if (tool.name.startsWith("browser_")) return "browser";
    if (tool.name.startsWith("slack_")) return "net:*.slack.com";
    if (tool.name.startsWith("file_")) return "file:read";
    if (tool.name === "exec_command") return "exec";
    return tool.plugin;
  }

  allTools(): IterableIterator<ToolDefinition> {
    return this.tools.values();
  }

  toAnthropicTools(): Array<{ name: string; description: string; input_schema: Record<string, unknown> }> {
    return Array.from(this.tools.values()).map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.input_schema,
    }));
  }

  toAnthropicToolsFiltered(allowedNames: Set<string>): Array<{ name: string; description: string; input_schema: Record<string, unknown> }> {
    return Array.from(this.tools.values())
      .filter((t) => allowedNames.has(t.name))
      .map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.input_schema,
      }));
  }

  get size(): number {
    return this.tools.size;
  }
}
