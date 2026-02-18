import type { ToolDefinition, ToolResult } from "../types/message.js";
import type { Logger } from "../types/plugin.js";

interface MCPServerConfig {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  transport?: "stdio" | "sse" | "http";
}

interface MCPTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

interface MCPClient {
  connect(transport: unknown): Promise<void>;
  close(): Promise<void>;
  listTools(): Promise<{ tools: MCPTool[] }>;
  callTool(params: { name: string; arguments: Record<string, unknown> }): Promise<{
    content: Array<{ type: string; text?: string }>;
    isError?: boolean;
  }>;
}

interface ConnectedServer {
  name: string;
  config: MCPServerConfig;
  client: MCPClient | null;
  transport: unknown;
  tools: MCPTool[];
  connected: boolean;
  error?: string;
}

export class MCPClientManager {
  private servers = new Map<string, ConnectedServer>();
  private logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  async connectServer(name: string, config: MCPServerConfig): Promise<void> {
    const serverEntry: ConnectedServer = {
      name,
      config,
      client: null,
      transport: null,
      tools: [],
      connected: false,
    };

    try {
      // Dynamically import the MCP SDK
      const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");

      const client = new Client(
        { name: "paw", version: "0.1.0" },
        { capabilities: {} },
      ) as MCPClient;

      const transportType = config.transport ?? "stdio";
      let transport: unknown;

      if (transportType === "stdio") {
        if (!config.command) {
          throw new Error(`MCP server "${name}" requires a command for stdio transport`);
        }
        const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js");
        transport = new StdioClientTransport({
          command: config.command,
          args: config.args ?? [],
          env: config.env ? { ...process.env, ...config.env } as Record<string, string> : undefined,
        });
      } else if (transportType === "sse") {
        if (!config.url) {
          throw new Error(`MCP server "${name}" requires a url for SSE transport`);
        }
        const { SSEClientTransport } = await import("@modelcontextprotocol/sdk/client/sse.js");
        transport = new SSEClientTransport(new URL(config.url));
      } else if (transportType === "http") {
        if (!config.url) {
          throw new Error(`MCP server "${name}" requires a url for HTTP transport`);
        }
        const { StreamableHTTPClientTransport } = await import("@modelcontextprotocol/sdk/client/streamableHttp.js");
        transport = new StreamableHTTPClientTransport(new URL(config.url));
      } else {
        throw new Error(`Unknown transport type: ${transportType}`);
      }

      await client.connect(transport);
      serverEntry.client = client;
      serverEntry.transport = transport;
      serverEntry.connected = true;

      this.logger.info("MCP server connected", { name, transport: transportType });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      serverEntry.error = message;
      this.logger.error("MCP server connection failed", { name, error: message });
    }

    this.servers.set(name, serverEntry);
  }

  async discoverTools(serverName: string): Promise<ToolDefinition[]> {
    const server = this.servers.get(serverName);
    if (!server?.client || !server.connected) return [];

    try {
      const { tools } = await server.client.listTools();
      server.tools = tools;

      return tools.map((tool) => this.wrapMCPTool(serverName, server.client!, tool));
    } catch (err) {
      this.logger.error("MCP tool discovery failed", { server: serverName, error: String(err) });
      return [];
    }
  }

  private wrapMCPTool(serverName: string, client: MCPClient, tool: MCPTool): ToolDefinition {
    const qualifiedName = `mcp__${serverName}__${tool.name}`;

    return {
      name: qualifiedName,
      description: tool.description ?? `MCP tool from ${serverName}`,
      input_schema: tool.inputSchema ?? { type: "object", properties: {} },
      plugin: `mcp:${serverName}`,
      handler: async (input: Record<string, unknown>): Promise<ToolResult> => {
        try {
          const result = await client.callTool({ name: tool.name, arguments: input });
          const text = result.content
            .filter((c) => c.type === "text" && c.text)
            .map((c) => c.text!)
            .join("\n");
          return { content: text || "(no output)", is_error: result.isError ?? false };
        } catch (err) {
          return { content: `MCP tool error: ${err instanceof Error ? err.message : String(err)}`, is_error: true };
        }
      },
    };
  }

  async disconnectServer(name: string): Promise<boolean> {
    const server = this.servers.get(name);
    if (!server) return false;

    if (server.client && server.connected) {
      try {
        await server.client.close();
        this.logger.info("MCP server disconnected", { name });
      } catch (err) {
        this.logger.error("MCP server disconnect failed", { name, error: String(err) });
      }
    }
    this.servers.delete(name);
    return true;
  }

  async disconnectAll(): Promise<void> {
    for (const [name, server] of this.servers) {
      if (server.client && server.connected) {
        try {
          await server.client.close();
          this.logger.info("MCP server disconnected", { name });
        } catch (err) {
          this.logger.error("MCP server disconnect failed", { name, error: String(err) });
        }
      }
    }
    this.servers.clear();
  }

  getServerInfo(): Array<{
    name: string;
    transport: string;
    connected: boolean;
    toolCount: number;
    tools: Array<{ name: string; description: string }>;
    error?: string;
  }> {
    return Array.from(this.servers.values()).map((s) => ({
      name: s.name,
      transport: s.config.transport ?? "stdio",
      connected: s.connected,
      toolCount: s.tools.length,
      tools: s.tools.map((t) => ({
        name: `mcp__${s.name}__${t.name}`,
        description: t.description ?? "",
      })),
      error: s.error,
    }));
  }

  get serverCount(): number {
    return this.servers.size;
  }

  get connectedCount(): number {
    return Array.from(this.servers.values()).filter((s) => s.connected).length;
  }
}
