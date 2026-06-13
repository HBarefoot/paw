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
	"strapi:ready": undefined;
	"strapi:error": { error: Error };
	"webhook:inbound": {
		webhookId: string;
		webhookName: string;
		slug: string;
		headers: Record<string, string>;
		body: unknown;
		timestamp: string;
	};
	"webhook:error": { webhookId: string; slug: string; error: string };
	"github:event": {
		eventType: string;
		action?: string;
		repo?: string;
		summary?: string;
		url?: string;
		sender?: string;
		payload: Record<string, unknown>;
		timestamp: string;
	};
	"notification:created": {
		id: string;
		kind: string;
		title: string;
		body?: string;
		url?: string;
		level: string;
	};
	// Approval surfaces. `approval:pending` is emitted when a gated action is
	// queued (each channel plugin delivers it to its origin); `approval:decision`
	// is emitted by a surface (e.g. the Slack plugin) and resolved kernel-side
	// after authorization; `approval:resolved` reports the final state so every
	// surface can sync (update its message, clear the companion, etc.).
	"approval:pending": {
		id: string;
		action: string;
		summary: string;
		repo: string;
		originChannel: string;
		originRef: string | null;
		requestedBy: string | null;
	};
	"approval:decision": {
		id: string;
		decision: "approve" | "reject";
		actorChannel: string;
		actorUserId: string;
	};
	"approval:resolved": {
		id: string;
		status: "executed" | "rejected" | "failed" | "unauthorized";
		decidedBy: string;
		originChannel: string | null;
		originRef: string | null;
	};
	"mcp:schema-drift": {
		server: string;
		tool: string;
		reason: "changed" | "removed";
		added: string[];
		removed: string[];
		typeChanged: string[];
		requiredChanged: boolean;
	};
}

export type EventName = keyof EventMap;
