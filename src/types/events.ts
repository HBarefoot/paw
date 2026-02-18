import type { InboundMessage, OutboundMessage } from "./message.js";

export interface EventMap {
  "message:inbound": InboundMessage;
  "message:outbound": OutboundMessage;
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
  "heartbeat:completed": { overallOk: boolean; checks: Array<{ name: string; ok: boolean; details?: string }> };
  "heartbeat:failure": { failedChecks: string[] };
  "security:user-approved": { userId: string };
  "security:permission-denied": { plugin: string; tool: string };
  "web:started": { host: string; port: number };
}

export type EventName = keyof EventMap;
