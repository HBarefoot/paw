import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import type { EventBus } from "../kernel/bus.js";
import type { CronScheduler } from "../cron/scheduler.js";
import type { MemoryStore } from "../memory/store.js";
import type { Logger } from "../types/plugin.js";

export interface HeartbeatCheck {
  name: string;
  ok: boolean;
  details?: string;
}

export interface HeartbeatResult {
  timestamp: string;
  checks: HeartbeatCheck[];
  overallOk: boolean;
  aiTriggered: boolean;
}

export interface HeartbeatConfig {
  intervalMinutes: number;
  triggerAiOnFailure: boolean;
  workspacePath: string;
}

export class HeartbeatChecker {
  private bus: EventBus;
  private cronScheduler: CronScheduler;
  private logger: Logger;
  private config: HeartbeatConfig;
  private healthCheckFn: () => Promise<Record<string, { ok: boolean; details?: string }>>;
  private memoryStore: MemoryStore | null;
  private dbPath: string;
  private cronJobId: string | null = null;

  constructor(opts: {
    bus: EventBus;
    cronScheduler: CronScheduler;
    logger: Logger;
    config: HeartbeatConfig;
    healthCheckFn: () => Promise<Record<string, { ok: boolean; details?: string }>>;
    memoryStore: MemoryStore | null;
    dbPath: string;
  }) {
    this.bus = opts.bus;
    this.cronScheduler = opts.cronScheduler;
    this.logger = opts.logger;
    this.config = opts.config;
    this.healthCheckFn = opts.healthCheckFn;
    this.memoryStore = opts.memoryStore;
    this.dbPath = opts.dbPath;
  }

  start(): void {
    // Register a cron job for the heartbeat interval
    const minutes = this.config.intervalMinutes;
    const expression = `*/${minutes} * * * *`;

    this.cronJobId = this.cronScheduler.addJob({
      name: "__heartbeat__",
      expression,
      action: { type: "event", event: "heartbeat:run" as any, payload: undefined },
    });

    // Listen for the heartbeat event and run check
    this.bus.on("heartbeat:completed" as any, () => {}); // type placeholder
    // Actually listen via a custom mechanism: the cron will fire the event,
    // but since we can't easily listen on arbitrary events, let's use a direct approach
    // Override: just use setInterval directly for simplicity
    this.cronScheduler.removeJob(this.cronJobId);
    this.cronJobId = null;

    // Use direct interval instead
    const intervalMs = minutes * 60 * 1000;
    const timer = setInterval(() => {
      this.runCheck().catch((err) => {
        this.logger.error("Heartbeat check failed", { error: String(err) });
      });
    }, intervalMs);

    // Store the timer for cleanup
    (this as any)._timer = timer;

    this.logger.info("Heartbeat started", { intervalMinutes: minutes });

    // Run initial check after 5 seconds
    setTimeout(() => this.runCheck().catch(() => {}), 5000);
  }

  stop(): void {
    const timer = (this as any)._timer;
    if (timer) {
      clearInterval(timer);
      (this as any)._timer = null;
    }
    this.logger.info("Heartbeat stopped");
  }

  async runCheck(): Promise<HeartbeatResult> {
    const checks: HeartbeatCheck[] = [];
    const timestamp = new Date().toISOString();

    // 1. Plugin health
    try {
      const health = await this.healthCheckFn();
      for (const [name, result] of Object.entries(health)) {
        checks.push({ name: `plugin:${name}`, ok: result.ok, details: result.details });
      }
    } catch (err) {
      checks.push({ name: "plugin-health", ok: false, details: String(err) });
    }

    // 2. Database size
    try {
      const stat = statSync(this.dbPath);
      const sizeMb = (stat.size / 1024 / 1024).toFixed(2);
      checks.push({ name: "db-size", ok: true, details: `${sizeMb} MB` });
    } catch {
      checks.push({ name: "db-size", ok: false, details: "Could not stat database file" });
    }

    // 3. Memory stats
    if (this.memoryStore) {
      try {
        const stats = this.memoryStore.getStats();
        checks.push({ name: "memory", ok: true, details: `${stats.totalMemories} memories stored` });
      } catch (err) {
        checks.push({ name: "memory", ok: false, details: String(err) });
      }
    }

    // 4. Cron status
    try {
      const jobs = this.cronScheduler.listJobs();
      const enabled = jobs.filter((j) => j.enabled).length;
      checks.push({ name: "cron", ok: true, details: `${enabled}/${jobs.length} jobs active` });
    } catch (err) {
      checks.push({ name: "cron", ok: false, details: String(err) });
    }

    // 5. HEARTBEAT.md custom checks
    const heartbeatPath = resolve(this.config.workspacePath, "HEARTBEAT.md");
    if (existsSync(heartbeatPath)) {
      try {
        const content = readFileSync(heartbeatPath, "utf-8");
        checks.push({ name: "heartbeat.md", ok: true, details: `Custom heartbeat file found (${content.length} chars)` });
      } catch {
        checks.push({ name: "heartbeat.md", ok: false, details: "Could not read HEARTBEAT.md" });
      }
    }

    const overallOk = checks.every((c) => c.ok);
    let aiTriggered = false;

    // Emit results
    await this.bus.emit("heartbeat:completed", {
      overallOk,
      checks: checks.map((c) => ({ name: c.name, ok: c.ok, details: c.details })),
    });

    if (!overallOk) {
      const failedChecks = checks.filter((c) => !c.ok).map((c) => c.name);
      await this.bus.emit("heartbeat:failure", { failedChecks });

      // Trigger AI if configured
      if (this.config.triggerAiOnFailure) {
        const failedDetails = checks
          .filter((c) => !c.ok)
          .map((c) => `- ${c.name}: ${c.details}`)
          .join("\n");

        await this.bus.emit("message:inbound", {
          id: crypto.randomUUID(),
          sessionId: `heartbeat-${Date.now()}`,
          channel: "heartbeat",
          content: `HEARTBEAT ALERT: The following checks failed:\n${failedDetails}\n\nPlease investigate and report what you find.`,
          user: { id: "system", name: "Heartbeat" },
          timestamp,
        });
        aiTriggered = true;
      }

      this.logger.warn("Heartbeat detected failures", { failedChecks });
    } else {
      this.logger.info("Heartbeat OK", { checks: checks.length });
    }

    // Store result as memory
    if (this.memoryStore) {
      const summary = overallOk
        ? `Heartbeat check passed: all ${checks.length} checks OK at ${timestamp}`
        : `Heartbeat check failed at ${timestamp}: ${checks.filter((c) => !c.ok).map((c) => c.name).join(", ")}`;
      await this.memoryStore.store(summary, { scope: "global", category: "summary", source: "heartbeat" }).catch(() => {});
    }

    return { timestamp, checks, overallOk, aiTriggered };
  }
}
