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

export interface ToolResult {
  content: string;
  is_error?: boolean;
}

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  plugin: string;
  handler: (input: Record<string, unknown>) => Promise<ToolResult>;
}
