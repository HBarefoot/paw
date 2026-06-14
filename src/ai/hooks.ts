import type { ToolResult } from "../types/message.js";
import type { Logger } from "../types/plugin.js";

/**
 * Lifecycle hooks on the tool-execution chokepoint (ToolRegistry.execute). One
 * clean extension surface for cross-cutting concerns — guardrails, metrics,
 * audit, alerts — so they don't each require a kernel edit. `before` hooks can
 * gate a call (deny / modify input / route to approval); `after` hooks observe
 * only and can never change a security outcome.
 */

export interface ToolHookContext {
	toolName: string;
	plugin: string | null;
	input: Record<string, unknown>;
	sessionId: string | null;
	/** Origin channel + routing ref, derived from the sessionId. */
	origin: { channel: string; ref: string | null };
}

export type BeforeVerdict =
	| { kind: "allow" }
	| { kind: "deny"; reason: string }
	| { kind: "modify"; input: Record<string, unknown> }
	| { kind: "require-approval"; reason: string };

export interface ToolHook {
	name: string;
	before?: (
		ctx: ToolHookContext,
	) => BeforeVerdict | undefined | Promise<BeforeVerdict | undefined>;
	after?: (
		ctx: ToolHookContext,
		result: ToolResult,
		durationMs: number,
	) => void | Promise<void>;
	/**
	 * If this hook's `before` THROWS: `true` ⇒ the call is DENIED (security gate,
	 * fail closed); falsy ⇒ the error is logged and the call proceeds (observer,
	 * fail open). A gate that can return `deny`/`require-approval` should set this.
	 */
	failClosed?: boolean;
}

export interface ToolMetric {
	count: number;
	errors: number;
	totalMs: number;
}

/** Enqueue a pending approval for a `require-approval` verdict. Returns the id, or null when unavailable. */
export type ApprovalSink = (
	ctx: ToolHookContext,
	reason: string,
) => string | null;

const NOOP_LOGGER: Logger = {
	debug() {},
	info() {},
	warn() {},
	error() {},
} as unknown as Logger;

export class HookManager {
	private hooks: ToolHook[] = [];
	private approvalSink: ApprovalSink | null = null;
	private metricsByTool = new Map<string, ToolMetric>();
	private readonly logger: Logger;

	constructor(logger?: Logger) {
		this.logger = logger ?? NOOP_LOGGER;
	}

	register(hook: ToolHook): void {
		this.hooks.push(hook);
	}

	hasHooks(): boolean {
		return this.hooks.length > 0;
	}

	setApprovalSink(fn: ApprovalSink | null): void {
		this.approvalSink = fn;
	}

	/**
	 * Run `before` hooks in registration order. `modify` threads the new input
	 * forward; `deny`/`require-approval` short-circuit. A throwing gate
	 * (`failClosed`) denies; a throwing observer is logged and skipped.
	 */
	async runBefore(
		ctx: ToolHookContext,
	): Promise<{ verdict: BeforeVerdict; input: Record<string, unknown> }> {
		let input = ctx.input;
		for (const h of this.hooks) {
			if (!h.before) continue;
			let v: BeforeVerdict | undefined;
			try {
				v = await h.before({ ...ctx, input });
			} catch (err) {
				this.logger.warn("before-hook threw", {
					hook: h.name,
					tool: ctx.toolName,
					error: String(err),
				});
				if (h.failClosed) {
					return {
						verdict: { kind: "deny", reason: `hook "${h.name}" failed` },
						input,
					};
				}
				continue; // observer → fail open
			}
			if (!v || v.kind === "allow") continue;
			if (v.kind === "modify") {
				input = v.input;
				continue;
			}
			// deny | require-approval → stop here.
			return { verdict: v, input };
		}
		return { verdict: { kind: "allow" }, input };
	}

	/** Run `after` observers. A throw is logged and never alters the result. */
	async runAfter(
		ctx: ToolHookContext,
		result: ToolResult,
		durationMs: number,
	): Promise<void> {
		for (const h of this.hooks) {
			if (!h.after) continue;
			try {
				await h.after(ctx, result, durationMs);
			} catch (err) {
				this.logger.warn("after-hook threw", {
					hook: h.name,
					tool: ctx.toolName,
					error: String(err),
				});
			}
		}
	}

	enqueueApproval(ctx: ToolHookContext, reason: string): string | null {
		if (!this.approvalSink) return null;
		try {
			return this.approvalSink(ctx, reason);
		} catch {
			return null;
		}
	}

	/** Aggregate a per-tool metric (used by the built-in metrics hook). */
	recordMetric(tool: string, isError: boolean, durationMs: number): void {
		const m = this.metricsByTool.get(tool) ?? {
			count: 0,
			errors: 0,
			totalMs: 0,
		};
		m.count += 1;
		if (isError) m.errors += 1;
		m.totalMs += durationMs;
		this.metricsByTool.set(tool, m);
	}

	/** Snapshot of per-tool metrics for the ops feed. */
	metrics(): Record<string, ToolMetric> {
		return Object.fromEntries(this.metricsByTool);
	}
}

// --- Built-in hooks -------------------------------------------------------

/** Observer: aggregate per-tool timing/success/failure into the HookManager. */
export function createMetricsHook(hm: HookManager): ToolHook {
	return {
		name: "metrics",
		after: (ctx, result, durationMs) => {
			hm.recordMetric(ctx.toolName, !!result.is_error, durationMs);
		},
	};
}

/** Tools whose calls are worth an audit-log entry (security-relevant surface). */
function isSecurityRelevant(toolName: string): boolean {
	return (
		toolName === "exec_command" ||
		toolName === "execute_code" ||
		toolName === "file_write" ||
		toolName === "canvas_write" ||
		toolName.startsWith("github_")
	);
}

/** Observer: audit security-relevant tool calls (mirrors existing audit usage). */
export function createAuditHook(
	audit: (action: string, details: Record<string, unknown>) => void,
): ToolHook {
	return {
		name: "audit",
		after: (ctx, result) => {
			if (!isSecurityRelevant(ctx.toolName)) return;
			audit(`tool.${ctx.toolName}`, {
				plugin: ctx.plugin,
				sessionId: ctx.sessionId,
				origin: ctx.origin.channel,
				isError: !!result.is_error,
			});
		},
	};
}

/**
 * Gate (fail-closed): deny or approval-gate tools by policy. Driven by config
 * (`hooks.denyTools` / `hooks.requireApprovalTools`); inert when both empty.
 * The documented extension pattern for adding a guardrail without kernel edits.
 */
export function createGuardrailHook(policy: {
	denyTools: string[];
	requireApprovalTools: string[];
}): ToolHook {
	const deny = new Set(policy.denyTools);
	const approve = new Set(policy.requireApprovalTools);
	return {
		name: "guardrail",
		failClosed: true,
		before: (ctx): BeforeVerdict => {
			if (deny.has(ctx.toolName)) {
				return {
					kind: "deny",
					reason: `tool "${ctx.toolName}" is denied by policy`,
				};
			}
			if (approve.has(ctx.toolName)) {
				return {
					kind: "require-approval",
					reason: `tool "${ctx.toolName}" requires human approval by policy`,
				};
			}
			return { kind: "allow" };
		},
	};
}
