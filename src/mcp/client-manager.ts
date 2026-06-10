import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type {
	ToolDefinition,
	ToolResult,
	ToolResultImage,
} from "../types/message.js";
import type { Logger } from "../types/plugin.js";
import { validateExternalUrl } from "../security/url-guard.js";

interface MCPServerConfig {
	command?: string;
	args?: string[];
	env?: Record<string, string>;
	url?: string;
	transport?: "stdio" | "sse" | "http";
}

// Default allowlist of safe MCP command executables
const DEFAULT_ALLOWED_COMMANDS = new Set([
	"npx",
	"node",
	"bun",
	"bunx",
	"deno",
	"python",
	"python3",
	"uvx",
	"docker",
	"podman",
	"kubectl",
]);

/**
 * Fetch options applied to every MCP HTTP/SSE request. H-NEW-3 + M-NEW-1:
 * `redirect: "error"` blocks SSRF pivots via 302 responses to internal
 * hosts. The MCP transport is not allowed to follow redirects.
 */
const MCP_REQUEST_INIT: RequestInit = {
	redirect: "error",
};

/**
 * Reject MCP tool/server identifiers that could break the qualified-name
 * scheme (`mcp__<server>__<tool>`). Double underscores inside either part
 * let a remote MCP tool masquerade as another namespace.
 */
function isSafeMcpIdentifier(name: string): boolean {
	if (!name || name.length > 128) return false;
	if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(name)) return false;
	if (name.includes("__")) return false;
	return true;
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
	callTool(params: {
		name: string;
		arguments: Record<string, unknown>;
	}): Promise<{
		content: Array<{
			type: string;
			text?: string;
			data?: string;
			mimeType?: string;
		}>;
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
	private allowedCommands: Set<string>;

	constructor(logger: Logger, allowedCommands?: string[]) {
		this.logger = logger;
		this.allowedCommands = allowedCommands
			? new Set(allowedCommands)
			: DEFAULT_ALLOWED_COMMANDS;
	}

	/**
	 * Validate a stdio command against the allowlist.
	 * Only the basename of the command is checked (e.g. "npx" from "/usr/bin/npx").
	 */
	private validateCommand(command: string, args: string[]): void {
		// Extract basename for allowlist check
		const basename = command.split("/").pop() ?? command;
		if (!this.allowedCommands.has(basename)) {
			throw new Error(
				`MCP command "${basename}" is not in the allowed list. ` +
					`Allowed: ${[...this.allowedCommands].join(", ")}. ` +
					`To allow additional commands, configure mcpAllowedCommands in config.`,
			);
		}

		// Reject shell metacharacters in args to prevent injection
		const shellMetaRe = /[;&|`$(){}!<>\\]/;
		for (const arg of args) {
			if (shellMetaRe.test(arg)) {
				throw new Error(
					`MCP server argument contains forbidden shell characters: "${arg}"`,
				);
			}
		}
	}

	/**
	 * Validate a URL is not targeting private/internal networks (SSRF prevention).
	 * Delegates to the unified `url-guard` so CGNAT, ULA, embedded credentials,
	 * and IPv4-mapped IPv6 are all blocked consistently.
	 */
	private validateUrl(urlStr: string): URL {
		const result = validateExternalUrl(urlStr, {
			allowedSchemes: ["http:", "https:"],
		});
		if (!result.ok || !result.url) {
			throw new Error(
				`MCP server URL rejected: ${result.reason ?? "unknown reason"}`,
			);
		}
		return result.url;
	}

	async connectServer(name: string, config: MCPServerConfig): Promise<void> {
		if (!isSafeMcpIdentifier(name)) {
			this.logger.error("Invalid MCP server name — refusing to connect", {
				server: name,
			});
			return;
		}
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
			const { Client } = await import(
				"@modelcontextprotocol/sdk/client/index.js"
			);

			const client = new Client(
				{ name: "paw", version: "0.1.0" },
				{ capabilities: {} },
			) as MCPClient;

			const transportType = config.transport ?? "stdio";
			let transport: unknown;

			if (transportType === "stdio") {
				if (!config.command) {
					throw new Error(
						`MCP server "${name}" requires a command for stdio transport`,
					);
				}
				// Validate command against allowlist
				this.validateCommand(config.command, config.args ?? []);

				const { StdioClientTransport } = await import(
					"@modelcontextprotocol/sdk/client/stdio.js"
				);
				transport = new StdioClientTransport({
					command: config.command,
					args: config.args ?? [],
					env: config.env
						? ({ ...process.env, ...config.env } as Record<string, string>)
						: undefined,
				});
			} else if (transportType === "sse") {
				if (!config.url) {
					throw new Error(
						`MCP server "${name}" requires a url for SSE transport`,
					);
				}
				// Validate URL is not targeting internal networks
				const url = this.validateUrl(config.url);
				const { SSEClientTransport } = await import(
					"@modelcontextprotocol/sdk/client/sse.js"
				);
				transport = new SSEClientTransport(url, {
					requestInit: MCP_REQUEST_INIT,
				});
			} else if (transportType === "http") {
				if (!config.url) {
					throw new Error(
						`MCP server "${name}" requires a url for HTTP transport`,
					);
				}
				// Validate URL is not targeting internal networks
				const url = this.validateUrl(config.url);
				const { StreamableHTTPClientTransport } = await import(
					"@modelcontextprotocol/sdk/client/streamableHttp.js"
				);
				transport = new StreamableHTTPClientTransport(url, {
					requestInit: MCP_REQUEST_INIT,
				});
			} else {
				throw new Error(`Unknown transport type: ${transportType}`);
			}

			await client.connect(transport);
			serverEntry.client = client;
			serverEntry.transport = transport;
			serverEntry.connected = true;

			this.logger.info("MCP server connected", {
				name,
				transport: transportType,
			});
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			serverEntry.error = message;
			this.logger.error("MCP server connection failed", {
				name,
				error: message,
			});
		}

		this.servers.set(name, serverEntry);
	}

	async discoverTools(serverName: string): Promise<ToolDefinition[]> {
		const server = this.servers.get(serverName);
		if (!server?.client || !server.connected) return [];

		try {
			const { tools } = await server.client.listTools();
			server.tools = tools;

			// Filter out tools whose names would produce invalid or confusing
			// qualified identifiers. Names must match a conservative allowlist
			// and contain no `__` sequences that could break namespacing.
			const validTools = tools.filter((t) => {
				if (!isSafeMcpIdentifier(t.name)) {
					this.logger.warn("MCP tool skipped: unsafe name", {
						server: serverName,
						tool: t.name,
					});
					return false;
				}
				return true;
			});

			return validTools.map((tool) =>
				this.wrapMCPTool(serverName, server.client!, tool),
			);
		} catch (err) {
			this.logger.error("MCP tool discovery failed", {
				server: serverName,
				error: String(err),
			});
			return [];
		}
	}

	private wrapMCPTool(
		serverName: string,
		client: MCPClient,
		tool: MCPTool,
	): ToolDefinition {
		const qualifiedName = `mcp__${serverName}__${tool.name}`;
		const logger = this.logger;

		return {
			name: qualifiedName,
			description: tool.description ?? `MCP tool from ${serverName}`,
			input_schema: tool.inputSchema ?? { type: "object", properties: {} },
			plugin: `mcp:${serverName}`,
			handler: async (input: Record<string, unknown>): Promise<ToolResult> => {
				try {
					const result = await client.callTool({
						name: tool.name,
						arguments: input,
					});

					// Log content block summary for debugging
					const blockSummary = (result.content ?? []).map((c: any) => ({
						type: c.type,
						hasData: !!c.data,
						hasMimeType: !!c.mimeType,
						hasBlob: !!c.resource?.blob,
						textPreview:
							c.type === "text" ? (c.text ?? "").slice(0, 100) : undefined,
					}));
					logger.debug("MCP tool result", {
						tool: tool.name,
						blocks: blockSummary,
					});

					// The MCP SDK may return content blocks as typed objects — access fields defensively
					const contentBlocks = result.content as Array<
						Record<string, unknown>
					>;
					const textParts: string[] = [];
					const images: ToolResultImage[] = [];

					for (const block of contentBlocks) {
						if (block.type === "text" && typeof block.text === "string") {
							textParts.push(block.text);
						} else if (
							block.type === "image" &&
							typeof block.data === "string"
						) {
							// Standard MCP ImageContent: { type: "image", data: base64, mimeType: "image/png" }
							const mt = (block.mimeType as string) || "image/png";
							if (
								["image/png", "image/jpeg", "image/gif", "image/webp"].includes(
									mt,
								)
							) {
								images.push({
									base64: block.data as string,
									media_type: mt as ToolResultImage["media_type"],
								});
							}
						} else if (
							block.type === "resource" &&
							typeof block.resource === "object" &&
							block.resource !== null
						) {
							// MCP EmbeddedResource: { type: "resource", resource: { blob: base64, mimeType, uri } }
							const res = block.resource as Record<string, unknown>;
							if (
								typeof res.blob === "string" &&
								typeof res.mimeType === "string"
							) {
								const mt = res.mimeType as string;
								if (
									mt.startsWith("image/") &&
									[
										"image/png",
										"image/jpeg",
										"image/gif",
										"image/webp",
									].includes(mt)
								) {
									images.push({
										base64: res.blob as string,
										media_type: mt as ToolResultImage["media_type"],
									});
								}
							} else if (typeof res.text === "string") {
								textParts.push(res.text);
							}
						}

						// Log unexpected content types for debugging
						if (!["text", "image", "resource"].includes(block.type as string)) {
							logger.debug("Unknown MCP content block type", {
								tool: tool.name,
								type: block.type,
								keys: Object.keys(block),
							});
						}
					}

					// Log image detection for debugging
					if (images.length > 0) {
						logger.info("MCP tool returned images", {
							tool: tool.name,
							count: images.length,
						});
					}

					const text = textParts.join("\n");
					return {
						content:
							text ||
							(images.length > 0
								? `Screenshot captured (${images.length} image(s))`
								: "(no output)"),
						images: images.length > 0 ? images : undefined,
						is_error: result.isError ?? false,
					};
				} catch (err) {
					return {
						content: `MCP tool error: ${err instanceof Error ? err.message : String(err)}`,
						is_error: true,
					};
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
				this.logger.error("MCP server disconnect failed", {
					name,
					error: String(err),
				});
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
					this.logger.error("MCP server disconnect failed", {
						name,
						error: String(err),
					});
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
