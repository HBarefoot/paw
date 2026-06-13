// Agent Ops live feed — the real operation stream behind the dashboard's
// canvas lenses (Swarm/Stream/…). Pure + dependency-light so it's unit-testable
// with plain fakes (no kernel boot): app.ts adapts the kernel into `OpsFeedDeps`
// and this builds the JSON the client `engine.js` consumes.
//
// Data sources (all real): completed ops come from `tool_log` (real durations);
// live "running" ops come from the ToolRegistry in-flight registry; topology is
// the skill/MCP node set; agents are the active sub-agent swarm. The client
// derives windowStats/totals/recent locally from this — same split as the
// design's sim (the engine is the only source; the views read from it).

import { estimateTokens } from "../../ai/cost-tracker.js";

/** Default scrub/backfill window: the dashboard rewinds ~the last 10 minutes. */
export const OPS_WINDOW_MS = 10 * 60 * 1000;
/** Cap on completed rows returned (tool_log read is bounded at 500). */
const OPS_MAX_ROWS = 500;

/** Teal→green→lime band (from the design's tool roster) for deterministic,
 * one-family coloring of real topology nodes. `core` is always the brand green. */
const TOOL_PALETTE = [
	"#2fd6c3",
	"#7ee06a",
	"#38d0d8",
	"#5fe0a4",
	"#46c6e6",
	"#9ae05f",
	"#34cfa8",
	"#2bbd78",
	"#45c8d8",
	"#5fe0a4",
];

export interface OpsTopologyNode {
	id: string;
	label: string;
	kind: string;
	color: string;
}

export interface OpsAgent {
	id: string;
	name: string;
	task: string;
	done: boolean;
	ok: boolean;
	ageMs: number;
}

export interface OpsOp {
	id: number;
	toolId: string;
	op: string;
	status: "running" | "ok" | "error";
	startedAt: number;
	endAt: number;
	duration: number;
	tokIn: number;
	tokOut: number;
	latency: number | null;
	args: string;
	/** Stable per-task id (hash of the sub-agent session) — 0 for orchestrator
	 *  / main-session ops (the Swarm lens groups agents by non-zero taskId). */
	taskId: number;
	taskLabel: string;
	session: string;
}

/** A tool_log row (structural — matches ToolLogEntry). */
interface ToolRow {
	id: number;
	session_id: string | null;
	tool_name: string;
	plugin: string | null;
	input_preview: string | null;
	output_preview: string | null;
	is_error: number;
	duration_ms: number | null;
	created_at: string;
}

/** An in-flight tool call (structural — matches ToolRegistry.InFlightOp). */
interface InFlightRow {
	seq: number;
	toolName: string;
	plugin: string | null;
	sessionId: string | null;
	startedAt: number;
	input: Record<string, unknown>;
}

export interface OpsFeedDeps {
	toolLog: { query(opts: { limit: number }): ToolRow[] } | null;
	inFlight: InFlightRow[];
	/** agentSceneNodes(kernel): { key, label, kind } (skills + MCP + strapi). */
	nodes: Array<{ key: string; label: string; kind: string }>;
	/** skillKeyForToolRow(kernel, row) bound — maps a row to a node key. */
	rowKey: (row: { tool_name: string; plugin: string | null }) => string | null;
	agents: OpsAgent[];
	model: string;
	now: number;
	/** GitHub actions awaiting human approval — drives the companion's "waiting"
	 *  face. 0 when GitHub is off / no approvals queue. */
	pendingApprovals?: number;
	/** Informative caption for the waiting face (e.g. "Waiting for your approval
	 *  — merge PR #42" / "2 actions awaiting approval"). */
	pendingApprovalsLabel?: string;
}

export interface OpsFeedResponse {
	now: number;
	cursor: number;
	working: boolean;
	model: string;
	windowMs: number;
	topology: OpsTopologyNode[];
	agents: OpsAgent[];
	ops: OpsOp[];
	inflight: OpsOp[];
	/** GitHub actions pending human approval (0 when none / GitHub off). */
	pendingApprovals: number;
	/** Caption for the waiting face (empty when nothing is pending). */
	pendingApprovalsLabel: string;
}

function cleanName(name: string): string {
	return name.replace(/^\[[^\]]+\]\s*/, "");
}

/** Parse SQLite `datetime('now')` ("YYYY-MM-DD HH:MM:SS", UTC) → epoch ms. */
function parseTs(s: string, fallback: number): number {
	const t = Date.parse(`${s.replace(" ", "T")}Z`);
	return Number.isFinite(t) ? t : fallback;
}

/** Build the topology node list: a `core` node first (reasoning + any unmapped
 * ops), then real nodes with deterministic family colors. Deduped by id — paw
 * has a real `core` skill, so the synthetic core is only added when `nodes`
 * doesn't already provide one, and any duplicate keys are dropped. */
function buildTopology(
	nodes: Array<{ key: string; label: string; kind: string }>,
): OpsTopologyNode[] {
	const out: OpsTopologyNode[] = [];
	const seen = new Set<string>();
	if (!nodes.some((n) => n.key === "core")) {
		out.push({ id: "core", label: "Core", kind: "reason", color: "#3fe08f" });
		seen.add("core");
	}
	nodes.forEach((n, i) => {
		if (seen.has(n.key)) return;
		seen.add(n.key);
		out.push({
			id: n.key,
			label: n.label,
			kind: n.kind,
			color:
				n.key === "core" ? "#3fe08f" : TOOL_PALETTE[i % TOOL_PALETTE.length],
		});
	});
	return out;
}

/**
 * Build the Agent Ops feed.
 * - `since === 0` → backfill: completed ops in the last `windowMs` (capped).
 * - `since > 0` → incremental: completed ops with tool_log id > since.
 * In-flight (running) ops are always returned as `inflight` (the client swaps
 * the running set wholesale each poll; completed ops accumulate by id).
 */
export function buildOpsFeed(
	deps: OpsFeedDeps,
	since: number,
	windowMs: number = OPS_WINDOW_MS,
): OpsFeedResponse {
	const { now } = deps;
	const topology = buildTopology(deps.nodes);
	const validId = new Set(topology.map((t) => t.id));
	const toolId = (row: {
		tool_name: string;
		plugin: string | null;
	}): string => {
		const k = deps.rowKey(row);
		return k && validId.has(k) ? k : "core";
	};

	// Agent attribution (Swarm): each distinct SUB-AGENT session becomes a swarm
	// agent; orchestrator / main-session ops stay taskId 0 (core, not a budded
	// agent). Sub-agent sessions are `agent-<name>-<ts>` (active ones carry a
	// real task label; recently-finished ones are still matched by the prefix).
	const agentBySession = new Map(deps.agents.map((a) => [a.id, a]));
	function hashTask(s: string): number {
		let h = 0;
		for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 1000000;
		return h || 1; // 0 is reserved for the orchestrator/main session
	}
	function attribute(session: string | null): {
		taskId: number;
		taskLabel: string;
		session: string;
	} {
		const s = session ?? "";
		const agent = s ? agentBySession.get(s) : undefined;
		const isAgent = !!agent || s.startsWith("agent-");
		if (!isAgent) return { taskId: 0, taskLabel: "", session: s };
		return {
			taskId: hashTask(s),
			taskLabel: agent?.task || "sub-agent",
			session: s,
		};
	}

	const rows = deps.toolLog?.query({ limit: OPS_MAX_ROWS }) ?? [];
	const windowStart = now - windowMs;
	const ops: OpsOp[] = [];
	let cursor = since;
	// rows come newest-first (id DESC); walk and collect, then sort ascending.
	for (const r of rows) {
		if (r.id > cursor) cursor = r.id;
		if (since > 0 ? r.id <= since : false) continue;
		const endAt = parseTs(r.created_at, now);
		const duration = r.duration_ms ?? 0;
		const startedAt = endAt - duration;
		if (since === 0 && endAt < windowStart) continue;
		const attr = attribute(r.session_id);
		ops.push({
			id: r.id,
			toolId: toolId(r),
			op: cleanName(r.tool_name),
			status: r.is_error ? "error" : "ok",
			startedAt,
			endAt,
			duration,
			tokIn: estimateTokens(r.input_preview ?? ""),
			tokOut: estimateTokens(r.output_preview ?? ""),
			latency: null,
			args: r.input_preview ?? "",
			taskId: attr.taskId,
			taskLabel: attr.taskLabel,
			session: attr.session,
		});
	}
	ops.sort((a, b) => a.startedAt - b.startedAt);

	const inflight: OpsOp[] = deps.inFlight.map((f) => {
		const attr = attribute(f.sessionId);
		return {
			id: -f.seq, // negative id space so running ops never collide with rows
			toolId: toolId({ tool_name: f.toolName, plugin: f.plugin }),
			op: cleanName(f.toolName),
			status: "running",
			startedAt: f.startedAt,
			endAt: now,
			duration: Math.max(0, now - f.startedAt),
			tokIn: estimateTokens(JSON.stringify(f.input ?? "")),
			tokOut: 0,
			latency: null,
			args: "",
			taskId: attr.taskId,
			taskLabel: attr.taskLabel,
			session: attr.session,
		};
	});

	return {
		now,
		cursor,
		working: inflight.length > 0 || deps.agents.some((a) => !a.done),
		model: deps.model,
		windowMs,
		topology,
		agents: deps.agents,
		ops,
		inflight,
		pendingApprovals: deps.pendingApprovals ?? 0,
		pendingApprovalsLabel: deps.pendingApprovalsLabel ?? "",
	};
}
