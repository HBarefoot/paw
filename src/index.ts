export { Kernel } from "./kernel/kernel.js";
export { EventBus } from "./kernel/bus.js";
export { ClaudeProvider } from "./ai/provider.js";
export { OllamaProvider } from "./ai/ollama-provider.js";
export { ToolRegistry } from "./ai/tools.js";
export { loadConfig } from "./config/loader.js";
export {
  loadCredentials,
  saveCredentials,
  getAnthropicCredentials,
  getAnthropicKey,
  getSlackCredentials,
  getStoredProvider,
  getOllamaConfig,
  readClaudeToken,
} from "./auth/credential-store.js";
export type { AIProvider, ChatMessage } from "./ai/base-provider.js";
export type { ChannelPlugin, PluginContext, Logger, PluginStore } from "./types/plugin.js";
export type { InboundMessage, OutboundMessage, ToolDefinition, ToolResult } from "./types/message.js";
export type { PawConfig } from "./types/config.js";
export type { StoredCredentials, AnthropicCredentials } from "./auth/credential-store.js";
