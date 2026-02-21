import type { EventBus } from "../kernel/bus.js";
import type { ToolDefinition } from "./message.js";

export interface Logger {
	info(msg: string, data?: Record<string, unknown>): void;
	warn(msg: string, data?: Record<string, unknown>): void;
	error(msg: string, data?: Record<string, unknown>): void;
	debug(msg: string, data?: Record<string, unknown>): void;
}

export interface PluginStore {
	get(key: string): unknown | undefined;
	set(key: string, value: unknown): void;
	delete(key: string): void;
}

export interface PluginContext {
	bus: EventBus;
	registerTools(tools: ToolDefinition[]): void;
	logger: Logger;
	config: Record<string, unknown>;
	store: PluginStore;
}

export interface ChannelPlugin {
	readonly name: string;
	register(ctx: PluginContext): Promise<void>;
	start(): Promise<void>;
	stop(): Promise<void>;
	health(): Promise<{ ok: boolean; details?: string }>;
}
