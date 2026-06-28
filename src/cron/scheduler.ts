import type { Database } from "bun:sqlite";
import type { EventBus } from "../kernel/bus.js";
import type { ToolRegistry } from "../ai/tools.js";
import type { AIProvider } from "../ai/base-provider.js";
import type { EventName } from "../types/events.js";
import { parseCron, nextRun } from "./parser.js";
import { evaluateProactiveTrigger } from "./proactive-trigger.js";
import type { Logger } from "../types/plugin.js";

export interface CronAction {
	type: "prompt" | "tool" | "event";
	prompt?: string;
	tool?: string;
	input?: Record<string, unknown>;
	/**
	 * The plugin that owns the tool (H-NEW-2). REQUIRED for `type: "tool"`
	 * actions (optional in the type only because prompt/event actions don't
	 * carry it). The scheduler refuses — at both addJob and executeAction — to
	 * run a tool action whose `plugin` is missing or doesn't own the registered
	 * tool, so a plugin-less job can't run a kernel tool (e.g. `exec_command`,
	 * which the sandbox would otherwise permit via the kernel `exec` grant).
	 */
	plugin?: string;
	event?: string;
	payload?: unknown;
}

/**
 * H-NEW-1: Cron "event" actions can fire ANY bus event with ANY payload.
 * That lets an attacker who can register a cron job (any web admin, or
 * any AI tool caller) fire `kernel:shutdown`, `message:inbound` (bypasses
 * access control via the kernel's INTERNAL_CHANNELS set), etc.
 *
 * Mitigation: a static allowlist of safe-to-fire events. Anything else
 * is rejected at job-creation time (in the web/API layer) and at
 * execution time (defense in depth).
 */
export const CRON_ALLOWED_EVENTS: ReadonlySet<string> = new Set<EventName>([
	"webhook:inbound",
	"webhook:error",
	"cron:executed",
	"cron:error",
	"memory:stored",
	"memory:recalled",
	"memory:forgotten",
]);

export function isAllowedCronEvent(name: string): boolean {
	return CRON_ALLOWED_EVENTS.has(name);
}

/**
 * Strip one matching pair of surrounding single/double quotes. Users who paste
 * a value into a free-text box (or whose tooling re-quotes form input) end up
 * with `"Health"` reaching validation, which then renders as the confusing
 * `Event ""Health"" is not in the allowlist` error. We unwrap a single pair so
 * a quoted-but-otherwise-valid identifier still resolves.
 */
export function stripWrappingQuotes(s: string): string {
	if (s.length >= 2) {
		const first = s[0];
		const last = s[s.length - 1];
		if (first === last && (first === '"' || first === "'")) {
			return s.slice(1, -1);
		}
	}
	return s;
}

/**
 * Suggest up to `limit` registered tool names closest to `query` (prefix
 * matches first, then substrings). Powers the "Did you mean …?" hint when an
 * API caller passes an unknown tool name.
 */
export function suggestToolNames(
	names: string[],
	query: string,
	limit = 5,
): string[] {
	const q = query.trim().toLowerCase();
	if (!q) return [];
	const prefix: string[] = [];
	const substring: string[] = [];
	for (const name of names) {
		const lower = name.toLowerCase();
		if (lower.startsWith(q)) prefix.push(name);
		else if (lower.includes(q) || q.includes(lower)) substring.push(name);
	}
	const ordered: string[] = [];
	for (const name of [...prefix, ...substring]) {
		if (!ordered.includes(name)) ordered.push(name);
		if (ordered.length >= limit) break;
	}
	return ordered;
}

export interface CronActionDeps {
	/** Look up a registered tool (for the H-NEW-2 plugin tag). */
	getTool(name: string): { plugin: string } | undefined;
	/** All registered tool names (for unknown-tool suggestions). */
	toolNames(): string[];
}

export type CronActionResult =
	| { action: CronAction }
	| { error: string };

/**
 * Validate + normalize raw cron-form input into a {@link CronAction}. This is
 * the single API-boundary seam for H-NEW-1 (event allowlist) and H-NEW-2 (tool
 * plugin tag); the scheduler re-enforces both at addJob/execute time (defense
 * in depth). Pure — no kernel coupling, so it is unit-testable in isolation.
 */
export function resolveCronAction(
	actionType: string,
	rawPayload: string,
	rawArgs: string | undefined,
	deps: CronActionDeps,
): CronActionResult {
	const trimmed = rawPayload.trim();

	if (actionType === "prompt") {
		// Keep the prompt verbatim — a prompt may legitimately open/close with a
		// quote; only identifier-typed payloads get unwrapped.
		return { action: { type: "prompt", prompt: trimmed } };
	}

	if (actionType === "tool") {
		const tool = stripWrappingQuotes(trimmed);
		const def = deps.getTool(tool);
		if (!def) {
			const hints = suggestToolNames(deps.toolNames(), tool);
			const suffix =
				hints.length > 0 ? ` Did you mean: ${hints.join(", ")}?` : "";
			return { error: `Unknown tool: ${tool}.${suffix}` };
		}
		const action: CronAction = { type: "tool", tool, plugin: def.plugin };
		const argsText = rawArgs?.trim();
		if (argsText) {
			let parsed: unknown;
			try {
				parsed = JSON.parse(argsText);
			} catch {
				return { error: "Tool args must be valid JSON." };
			}
			if (
				typeof parsed !== "object" ||
				parsed === null ||
				Array.isArray(parsed)
			) {
				return { error: "Tool args must be a JSON object." };
			}
			action.input = parsed as Record<string, unknown>;
		}
		return { action };
	}

	if (actionType === "event") {
		const event = stripWrappingQuotes(trimmed);
		if (!isAllowedCronEvent(event)) {
			const allowed = [...CRON_ALLOWED_EVENTS].join(", ");
			return {
				error: `Event "${event}" is not in the cron event allowlist. Allowed: ${allowed}`,
			};
		}
		return { action: { type: "event", event } };
	}

	return { error: `Unknown action type: ${actionType}` };
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
	isProactive: boolean;
	actionCondition: string | null;
	dataSource: string | null;
	lastDataHash: string | null;
}

export interface CronJobInput {
	name: string;
	expression: string;
	timezone?: string;
	action: CronAction;
	/** If true, the action_condition is evaluated before executing. */
	isProactive?: boolean;
	/** AI evaluation prompt — decides whether the action should run. */
	actionCondition?: string;
	/** URL or file path to fetch data for the condition evaluation. */
	dataSource?: string;
}

export class CronScheduler {
	private db: Database;
	private bus: EventBus;
	private toolRegistry: ToolRegistry;
	private logger: Logger;
	private tickInterval: ReturnType<typeof setInterval> | null = null;
	private tickMs: number;
	private onPromptAction?: (
		jobId: string,
		jobName: string,
		prompt: string,
	) => Promise<void>;
	private aiProvider: AIProvider | null = null;
	private workspacePath = ".";

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

	setPromptHandler(
		handler: (jobId: string, jobName: string, prompt: string) => Promise<void>,
	): void {
		this.onPromptAction = handler;
	}

	setAIProvider(provider: AIProvider): void {
		this.aiProvider = provider;
	}

	setWorkspacePath(path: string): void {
		this.workspacePath = path;
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
		// H-NEW-1 / H-NEW-2: validate action at creation time. Defense in
		// depth: the executeAction path also enforces these checks.
		if (input.action.type === "event") {
			if (!input.action.event || !isAllowedCronEvent(input.action.event)) {
				throw new Error(
					`Cron event action refused: "${input.action.event}" is not in the allowlist`,
				);
			}
		} else if (input.action.type === "tool") {
			if (!input.action.tool) {
				throw new Error("Cron tool action refused: empty tool name");
			}
			// H-NEW-2: a tool action MUST declare its owning plugin (previously
			// this was opt-in — `if (input.action.plugin)` — so a plugin-less
			// programmatic addJob caller could schedule e.g. `exec_command` with
			// no gate, since the sandbox grants the kernel `exec`). When the tool
			// is registered, the declared plugin must match its owner.
			// `executeAction` re-checks both at run time (defense in depth).
			if (!input.action.plugin) {
				throw new Error(
					`Cron tool action refused: tool "${input.action.tool}" must declare its owning plugin`,
				);
			}
			const def = this.toolRegistry.get(input.action.tool);
			if (def && def.plugin !== input.action.plugin) {
				throw new Error(
					`Cron tool action refused: tool "${input.action.tool}" belongs to plugin "${def.plugin}", not "${input.action.plugin}"`,
				);
			}
		}
		const id = crypto.randomUUID();
		const schedule = parseCron(input.expression);
		const next = nextRun(schedule, new Date(), input.timezone ?? "UTC");

		this.db.run(
			`INSERT INTO cron_jobs (id, name, expression, timezone, action_type, action_payload, enabled, next_run, is_proactive, action_condition, data_source)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
			[
				id,
				input.name,
				input.expression,
				input.timezone ?? "UTC",
				input.action.type,
				JSON.stringify(input.action),
				next.toISOString(),
				input.isProactive ? 1 : 0,
				input.actionCondition ?? null,
				input.dataSource ?? null,
			],
		);

		this.logger.info("Cron job added", {
			id,
			name: input.name,
			expression: input.expression,
			isProactive: !!input.isProactive,
		});
		return id;
	}

	removeJob(id: string): boolean {
		const result = this.db.run("DELETE FROM cron_jobs WHERE id = ?", [id]);
		return result.changes > 0;
	}

	enableJob(id: string): boolean {
		const result = this.db.run(
			"UPDATE cron_jobs SET enabled = 1 WHERE id = ?",
			[id],
		);
		return result.changes > 0;
	}

	disableJob(id: string): boolean {
		const result = this.db.run(
			"UPDATE cron_jobs SET enabled = 0 WHERE id = ?",
			[id],
		);
		return result.changes > 0;
	}

	listJobs(): CronJob[] {
		const rows = this.db
			.prepare<
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
					is_proactive: number;
					action_condition: string | null;
					data_source: string | null;
					last_data_hash: string | null;
				},
				[]
			>("SELECT * FROM cron_jobs ORDER BY next_run")
			.all();

		return rows.map((r) => this.rowToJob(r));
	}

	getJob(id: string): CronJob | null {
		const r = this.db
			.prepare<
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
					is_proactive: number;
					action_condition: string | null;
					data_source: string | null;
					last_data_hash: string | null;
				},
				[string]
			>("SELECT * FROM cron_jobs WHERE id = ?")
			.get(id);

		if (!r) return null;
		return this.rowToJob(r);
	}

	private rowToJob(r: {
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
		is_proactive: number;
		action_condition: string | null;
		data_source: string | null;
		last_data_hash: string | null;
	}): CronJob {
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
			isProactive: r.is_proactive === 1,
			actionCondition: r.action_condition,
			dataSource: r.data_source,
			lastDataHash: r.last_data_hash,
		};
	}

	private async tick(): Promise<void> {
		const now = new Date();
		const dueJobs = this.db
			.prepare<
				{
					id: string;
					name: string;
					expression: string;
					timezone: string;
					action_payload: string;
					is_proactive: number;
					action_condition: string | null;
					data_source: string | null;
					last_data_hash: string | null;
				},
				[string]
			>(
				"SELECT id, name, expression, timezone, action_payload, is_proactive, action_condition, data_source, last_data_hash FROM cron_jobs WHERE enabled = 1 AND next_run <= ?",
			)
			.all(now.toISOString());

		for (const job of dueJobs) {
			try {
				const action = JSON.parse(job.action_payload) as CronAction;

				// Proactive trigger: evaluate condition before executing
				if (job.is_proactive === 1 && job.action_condition) {
					if (!this.aiProvider) {
						this.logger.warn(
							"Proactive trigger skipped: no AI provider set",
							{ jobId: job.id },
						);
						// Still advance next_run so we don't hot-loop every tick.
						const schedule = parseCron(job.expression);
						const next = nextRun(schedule, now, job.timezone);
						this.db.run(
							"UPDATE cron_jobs SET last_run = ?, next_run = ? WHERE id = ?",
							[now.toISOString(), next.toISOString(), job.id],
						);
						continue;
					}
					{
						const evalResult = await evaluateProactiveTrigger({
							condition: job.action_condition,
							dataSource: job.data_source ?? undefined,
							lastDataHash: job.last_data_hash,
							provider: this.aiProvider,
							logger: this.logger,
							workspacePath: this.workspacePath,
						});

						// Update hash if data was fetched
						if (evalResult.newHash) {
							this.db.run(
								"UPDATE cron_jobs SET last_data_hash = ? WHERE id = ?",
								[evalResult.newHash, job.id],
							);
						}

						await this.bus.emit("cron:evaluated" as any, {
							jobId: job.id,
							jobName: job.name,
							shouldAct: evalResult.shouldAct,
							reason: evalResult.reason,
							dataChanged: evalResult.dataChanged,
						});

						if (!evalResult.shouldAct) {
							this.logger.info("Proactive trigger: skipped", {
								jobId: job.id,
								name: job.name,
								reason: evalResult.reason,
							});
							// Still update next_run so we check again later
							const schedule = parseCron(job.expression);
							const next = nextRun(schedule, now, job.timezone);
							this.db.run(
								"UPDATE cron_jobs SET last_run = ?, next_run = ? WHERE id = ?",
								[now.toISOString(), next.toISOString(), job.id],
							);
							continue;
						}

						this.logger.info("Proactive trigger: firing", {
							jobId: job.id,
							name: job.name,
							reason: evalResult.reason,
						});
					}
				}

				await this.executeAction(job.id, job.name, action);

				// Update last_run and next_run
				const schedule = parseCron(job.expression);
				const next = nextRun(schedule, now, job.timezone);
				this.db.run(
					"UPDATE cron_jobs SET last_run = ?, next_run = ? WHERE id = ?",
					[now.toISOString(), next.toISOString(), job.id],
				);

				await this.bus.emit("cron:executed", {
					jobId: job.id,
					jobName: job.name,
					success: true,
				});
				this.logger.info("Cron job executed", {
					jobId: job.id,
					name: job.name,
				});
			} catch (err) {
				await this.bus.emit("cron:error", {
					jobId: job.id,
					error: String(err),
				});
				this.logger.error("Cron job failed", {
					jobId: job.id,
					name: job.name,
					error: String(err),
				});
			}
		}
	}

	private async executeAction(
		jobId: string,
		jobName: string,
		action: CronAction,
	): Promise<void> {
		switch (action.type) {
			case "prompt":
				if (!action.prompt) {
					this.logger.warn("Cron prompt action has empty prompt", {
						jobId,
						jobName,
					});
					break;
				}
				if (!this.onPromptAction) {
					this.logger.warn("Cron prompt handler not registered", {
						jobId,
						jobName,
					});
					break;
				}
				await this.onPromptAction(jobId, jobName, action.prompt);
				break;
			case "tool":
				if (!action.tool) {
					this.logger.warn("Cron tool action has empty tool name", {
						jobId,
						jobName,
					});
					break;
				}
				// H-NEW-2: cron tool actions are plugin-gated. Without it, any
				// admin (or AI caller, or a row that bypassed addJob validation)
				// could run `exec_command` or other dangerous tools regardless of
				// the current session's skills — gated only by the sandbox, which
				// grants the kernel `exec`. The action MUST carry a `plugin`, and
				// that plugin MUST own the registered tool. This is the
				// execution-time re-validation backing the addJob check.
				const cronTool = this.toolRegistry.get(action.tool);
				if (!cronTool) {
					this.logger.warn("Cron tool action references unknown tool", {
						jobId,
						jobName,
						tool: action.tool,
					});
					break;
				}
				if (!action.plugin || cronTool.plugin !== action.plugin) {
					this.logger.warn("Cron tool action blocked: plugin gate", {
						jobId,
						jobName,
						tool: action.tool,
						declaredPlugin: action.plugin ?? null,
						actualPlugin: cronTool.plugin,
					});
					break;
				}
				await this.toolRegistry.execute(action.tool, action.input ?? {});
				break;
			case "event":
				if (!action.event) {
					this.logger.warn("Cron event action has empty event name", {
						jobId,
						jobName,
					});
					break;
				}
				// H-NEW-1: reject events not in the static allowlist. Even
				// if a malicious job somehow got into the DB (bypassing the
				// web/API validation), the scheduler refuses to fire it.
				if (!isAllowedCronEvent(action.event)) {
					this.logger.warn("Cron event action blocked: not in allowlist", {
						jobId,
						jobName,
						event: action.event,
					});
					break;
				}
				// Emit as a typed event from the allowlist. The cast is now
				// safe because we've already validated the name.
				await (this.bus as { emit: (n: string, p: unknown) => Promise<unknown> }).emit(
					action.event,
					action.payload,
				);
				break;
		}
	}
}
