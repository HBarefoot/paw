import type { StreamChunk } from "../ai/base-provider.js";
import type { InboundMessage, OutboundMessage } from "./message.js";

export interface EventMap {
	"message:inbound": InboundMessage;
	"message:outbound": OutboundMessage;
	"message:stream": {
		sessionId: string;
		channel: string;
		chunk: StreamChunk;
	};
	"plugin:started": { name: string };
	"plugin:stopped": { name: string };
	"plugin:error": { name: string; error: Error };
	"kernel:ready": undefined;
	"kernel:shutdown": undefined;
	"memory:stored": { id: string; text: string; category: string };
	"memory:recalled": { query: string; resultCount: number };
	"memory:forgotten": { id: string };
	"cron:executed": { jobId: string; jobName: string; success: boolean };
	"cron:error": { jobId: string; error: string };
	"heartbeat:completed": {
		overallOk: boolean;
		checks: Array<{ name: string; ok: boolean; details?: string }>;
	};
	"heartbeat:failure": { failedChecks: string[] };
	"security:user-approved": { userId: string };
	"security:permission-denied": { plugin: string; tool: string };
	"web:started": { host: string; port: number };
	"agent:delegated": {
		agentName: string;
		parentSessionId: string;
		agentSessionId: string;
		task: string;
	};
	"agent:completed": {
		agentName: string;
		agentSessionId: string;
		ok: boolean;
		error?: string;
	};
	"webhook:inbound": {
		webhookId: string;
		webhookName: string;
		slug: string;
		headers: Record<string, string>;
		body: unknown;
		timestamp: string;
	};
	"webhook:error": { webhookId: string; slug: string; error: string };
}

export type EventName = keyof EventMap;
