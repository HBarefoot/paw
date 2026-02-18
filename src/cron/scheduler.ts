import type { Database } from "bun:sqlite";
import type { EventBus } from "../kernel/bus.js";
import type { ToolRegistry } from "../ai/tools.js";
import { parseCron, nextRun } from "./parser.js";
import type { Logger } from "../types/plugin.js";

export interface CronAction {
  type: "prompt" | "tool" | "event";
  prompt?: string;
  tool?: string;
  input?: Record<string, unknown>;
  event?: string;
  payload?: unknown;
}

export interface CronJob {
  id: string;
  name: string;
  expression: string;
  timezone: string;
  action: CronAction;
  enabled: boolean;
  lastRun: string | null;
  nextRun: string;
  createdAt: string;
}

export interface CronJobInput {
  name: string;
  expression: string;
  timezone?: string;
  action: CronAction;
}

export class CronScheduler {
  private db: Database;
  private bus: EventBus;
  private toolRegistry: ToolRegistry;
  private logger: Logger;
  private tickInterval: ReturnType<typeof setInterval> | null = null;
  private tickMs: number;
  private onPromptAction?: (jobId: string, prompt: string) => Promise<void>;

  constructor(
    db: Database,
    bus: EventBus,
    toolRegistry: ToolRegistry,
    logger: Logger,
    tickMs = 60_000,
  ) {
    this.db = db;
    this.bus = bus;
    this.toolRegistry = toolRegistry;
    this.logger = logger;
    this.tickMs = tickMs;
  }

  setPromptHandler(handler: (jobId: string, prompt: string) => Promise<void>): void {
    this.onPromptAction = handler;
  }

  start(): void {
    this.logger.info("Cron scheduler started", { tickMs: this.tickMs });
    this.tickInterval = setInterval(() => this.tick(), this.tickMs);
    // Run immediately on start
    this.tick();
  }

  stop(): void {
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }
    this.logger.info("Cron scheduler stopped");
  }

  addJob(input: CronJobInput): string {
    const id = crypto.randomUUID();
    const schedule = parseCron(input.expression);
    const next = nextRun(schedule, new Date(), input.timezone ?? "UTC");

    this.db.run(
      `INSERT INTO cron_jobs (id, name, expression, timezone, action_type, action_payload, enabled, next_run)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?)`,
      [
        id,
        input.name,
        input.expression,
        input.timezone ?? "UTC",
        input.action.type,
        JSON.stringify(input.action),
        next.toISOString(),
      ],
    );

    this.logger.info("Cron job added", { id, name: input.name, expression: input.expression });
    return id;
  }

  removeJob(id: string): boolean {
    const result = this.db.run("DELETE FROM cron_jobs WHERE id = ?", [id]);
    return result.changes > 0;
  }

  enableJob(id: string): boolean {
    const result = this.db.run("UPDATE cron_jobs SET enabled = 1 WHERE id = ?", [id]);
    return result.changes > 0;
  }

  disableJob(id: string): boolean {
    const result = this.db.run("UPDATE cron_jobs SET enabled = 0 WHERE id = ?", [id]);
    return result.changes > 0;
  }

  listJobs(): CronJob[] {
    const rows = this.db.prepare<
      {
        id: string;
        name: string;
        expression: string;
        timezone: string;
        action_type: string;
        action_payload: string;
        enabled: number;
        last_run: string | null;
        next_run: string;
        created_at: string;
      },
      []
    >("SELECT * FROM cron_jobs ORDER BY next_run").all();

    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      expression: r.expression,
      timezone: r.timezone,
      action: JSON.parse(r.action_payload) as CronAction,
      enabled: r.enabled === 1,
      lastRun: r.last_run,
      nextRun: r.next_run,
      createdAt: r.created_at,
    }));
  }

  getJob(id: string): CronJob | null {
    const r = this.db.prepare<
      {
        id: string;
        name: string;
        expression: string;
        timezone: string;
        action_type: string;
        action_payload: string;
        enabled: number;
        last_run: string | null;
        next_run: string;
        created_at: string;
      },
      [string]
    >("SELECT * FROM cron_jobs WHERE id = ?").get(id);

    if (!r) return null;

    return {
      id: r.id,
      name: r.name,
      expression: r.expression,
      timezone: r.timezone,
      action: JSON.parse(r.action_payload) as CronAction,
      enabled: r.enabled === 1,
      lastRun: r.last_run,
      nextRun: r.next_run,
      createdAt: r.created_at,
    };
  }

  private async tick(): Promise<void> {
    const now = new Date();
    const dueJobs = this.db.prepare<
      { id: string; name: string; expression: string; timezone: string; action_payload: string },
      [string]
    >(
      "SELECT id, name, expression, timezone, action_payload FROM cron_jobs WHERE enabled = 1 AND next_run <= ?",
    ).all(now.toISOString());

    for (const job of dueJobs) {
      try {
        const action = JSON.parse(job.action_payload) as CronAction;
        await this.executeAction(job.id, job.name, action);

        // Update last_run and next_run
        const schedule = parseCron(job.expression);
        const next = nextRun(schedule, now, job.timezone);
        this.db.run(
          "UPDATE cron_jobs SET last_run = ?, next_run = ? WHERE id = ?",
          [now.toISOString(), next.toISOString(), job.id],
        );

        await this.bus.emit("cron:executed", { jobId: job.id, jobName: job.name, success: true });
        this.logger.info("Cron job executed", { jobId: job.id, name: job.name });
      } catch (err) {
        await this.bus.emit("cron:error", { jobId: job.id, error: String(err) });
        this.logger.error("Cron job failed", { jobId: job.id, name: job.name, error: String(err) });
      }
    }
  }

  private async executeAction(jobId: string, jobName: string, action: CronAction): Promise<void> {
    switch (action.type) {
      case "prompt":
        if (action.prompt && this.onPromptAction) {
          await this.onPromptAction(jobId, action.prompt);
        }
        break;
      case "tool":
        if (action.tool) {
          await this.toolRegistry.execute(action.tool, action.input ?? {});
        }
        break;
      case "event":
        if (action.event) {
          // Emit as a generic event - the bus will type-check at runtime
          await (this.bus as any).emit(action.event, action.payload);
        }
        break;
    }
  }
}
