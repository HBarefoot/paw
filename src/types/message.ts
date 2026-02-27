export interface Attachment {
	type: "image" | "file" | "text";
	url?: string;
	data?: Buffer;
	mimeType?: string;
	name?: string;
}

export interface InboundMessage {
	id: string;
	sessionId: string;
	channel: string;
	content: string;
	attachments?: Attachment[];
	user: { id: string; name?: string };
	timestamp: string;
	metadata?: Record<string, unknown>;
}

export interface OutboundMessage {
	sessionId: string;
	channel: string;
	content: string;
	attachments?: Attachment[];
	metadata?: Record<string, unknown>;
}

export interface ToolResultImage {
	base64: string;
	media_type: "image/png" | "image/jpeg" | "image/gif" | "image/webp";
}

export interface ToolResult {
	content: string;
	images?: ToolResultImage[];
	is_error?: boolean;
}

export interface ToolDefinition {
	name: string;
	description: string;
	input_schema: Record<string, unknown>;
	plugin: string;
	handler: (input: Record<string, unknown>) => Promise<ToolResult>;
	/**
	 * Optional streaming handler for tools that produce incremental progress.
	 * When present and the provider is streaming, the provider yields each
	 * StreamChunk from the generator to the parent stream. The generator's
	 * return value is used as the ToolResult.
	 */
	streamHandler?: (
		input: Record<string, unknown>,
	) => AsyncGenerator<import("../ai/base-provider.js").StreamChunk, ToolResult>;
}
