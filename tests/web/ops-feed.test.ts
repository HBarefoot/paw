import { describe, expect, test } from "bun:test";
import {
	OPS_WINDOW_MS,
	type OpsFeedDeps,
	type OpsOp,
	buildOpsFeed,
} from "../../src/web/routes/ops-feed.js";

const NOW = Date.parse("2026-06-12T00:10:00Z");

/** "YYYY-MM-DD HH:MM:SS" (UTC) for an epoch ms, like SQLite datetime('now'). */
function ts(ms: number): string {
	return new Date(ms).toISOString().slice(0, 19).replace("T", " ");
}

type Row = {
	id: number;
	session_id: string | null;
	tool_name: string;
	plugin: string | null;
	input_preview: string | null;
	output_preview: string | null;
	is_error: number;
	duration_ms: number | null;
	created_at: string;
};

function row(
	id: number,
	name: string,
	agoMs: number,
	dur: number,
	err = 0,
	session: string | null = null,
): Row {
	return {
		id,
		session_id: session,
		tool_name: name,
		plugin: null,
		input_preview: "package.json",
		output_preview: "result-text",
		is_error: err,
		duration_ms: dur,
		created_at: ts(NOW - agoMs),
	};
}

function rowKey(r: { tool_name: string }): string | null {
	if (r.tool_name.includes("file_read")) return "files";
	if (r.tool_name.includes("memory")) return "memory";
	if (r.tool_name.includes("weird")) return "ghost"; // not in topology → core
	return null;
}

function deps(over: Partial<OpsFeedDeps> = {}): OpsFeedDeps {
	const rows: Row[] = [
		row(12, "[skills] file_read", 5000, 200), // within window, ok
		row(11, "memory_search", 60000, 500, 1), // within window, error
		row(13, "weird_thing", 3000, 50), // within window, unmapped → core
		row(10, "old_op", 900000, 100), // 15 min ago → OUTSIDE 10-min window
	].sort((a, b) => b.id - a.id); // newest-first like the real query
	return {
		toolLog: { query: () => rows },
		inFlight: [
			{
				seq: 3,
				toolName: "[plugin] web_search",
				plugin: "web",
				sessionId: null,
				startedAt: NOW - 1500,
				input: { q: "hi" },
			},
		],
		nodes: [
			{ key: "files", label: "Files", kind: "skill" },
			{ key: "memory", label: "Memory", kind: "skill" },
		],
		rowKey,
		agents: [
			{
				id: "a1",
				name: "researcher",
				task: "dig",
				done: false,
				ok: false,
				ageMs: 2000,
			},
		],
		model: "test-model",
		now: NOW,
		...over,
	};
}

const byOp = (ops: OpsOp[], name: string) => ops.find((o) => o.op === name);

describe("buildOpsFeed", () => {
	test("topology: synthetic core first (green), real nodes colored", () => {
		const f = buildOpsFeed(deps(), 0);
		expect(f.topology[0]).toMatchObject({
			id: "core",
			color: "#3fe08f",
			kind: "reason",
		});
		const ids = f.topology.map((t) => t.id);
		expect(ids).toEqual(["core", "files", "memory"]);
		expect(f.topology[1].color).not.toBe("#3fe08f"); // family color, not core green
	});

	test("topology dedupes a real 'core' node (no duplicate Core lane)", () => {
		// paw has a real `core` skill — it must not duplicate the synthetic one.
		const f = buildOpsFeed(
			deps({
				nodes: [
					{ key: "core", label: "Core", kind: "skill" },
					{ key: "files", label: "Files", kind: "skill" },
				],
			}),
			0,
		);
		const ids = f.topology.map((t) => t.id);
		expect(ids).toEqual(["core", "files"]); // exactly one core
		expect(ids.filter((id) => id === "core")).toHaveLength(1);
		expect(f.topology.find((t) => t.id === "core")?.color).toBe("#3fe08f");
	});

	test("backfill (since=0) returns ops within the window, ascending", () => {
		const f = buildOpsFeed(deps(), 0);
		const ops = f.ops;
		// old_op (15 min) is excluded; the 3 recent ops remain.
		expect(ops.map((o) => o.op).sort()).toEqual([
			"file_read",
			"memory_search",
			"weird_thing",
		]);
		expect(byOp(ops, "old_op")).toBeUndefined();
		// ascending by startedAt: memory_search (-60s) before file_read (-5s) before weird_thing (-3s)
		expect(ops.map((o) => o.op)).toEqual([
			"memory_search",
			"file_read",
			"weird_thing",
		]);
		expect(f.cursor).toBe(13);
		expect(f.windowMs).toBe(OPS_WINDOW_MS);
	});

	test("op-field derivation: toolId mapping, start=end-duration, status", () => {
		const ops = buildOpsFeed(deps(), 0).ops;
		const fr = byOp(ops, "file_read");
		expect(fr?.toolId).toBe("files");
		expect(fr?.status).toBe("ok");
		expect(fr?.endAt).toBe(NOW - 5000);
		expect(fr?.startedAt).toBe((fr?.endAt ?? 0) - 200);
		expect(fr?.tokIn).toBeGreaterThan(0);
		expect(byOp(ops, "memory_search")?.status).toBe("error");
	});

	test("unmapped / unknown-node rows fall back to core", () => {
		const ops = buildOpsFeed(deps(), 0).ops;
		// rowKey returns "ghost" which isn't in topology → core
		expect(byOp(ops, "weird_thing")?.toolId).toBe("core");
	});

	test("in-flight → running ops (negative id, running status, core fallback)", () => {
		const f = buildOpsFeed(deps(), 0);
		expect(f.inflight).toHaveLength(1);
		const r = f.inflight[0];
		expect(r.status).toBe("running");
		expect(r.id).toBe(-3);
		expect(r.op).toBe("web_search"); // [plugin] prefix stripped
		expect(r.toolId).toBe("core"); // "web" not in topology
		expect(r.duration).toBe(1500);
	});

	test("incremental (since>0) returns only ops with id > since", () => {
		const f = buildOpsFeed(deps(), 12);
		expect(f.ops.map((o) => o.op)).toEqual(["weird_thing"]); // only id 13 > 12
		expect(f.cursor).toBe(13);
	});

	test("data window is respected and capped to the stated window", () => {
		// A row exactly at the window edge stays; older drops.
		const edge = row(20, "edge_op", OPS_WINDOW_MS - 1000, 100);
		const stale = row(21, "stale_op", OPS_WINDOW_MS + 60000, 100);
		const f = buildOpsFeed(
			deps({ toolLog: { query: () => [stale, edge] } }),
			0,
		);
		expect(byOp(f.ops, "edge_op")).toBeDefined();
		expect(byOp(f.ops, "stale_op")).toBeUndefined();
	});

	test("working reflects in-flight or active agents", () => {
		expect(buildOpsFeed(deps(), 0).working).toBe(true);
		const idle = buildOpsFeed(deps({ inFlight: [], agents: [] }), 0);
		expect(idle.working).toBe(false);
		const agentOnly = buildOpsFeed(deps({ inFlight: [] }), 0);
		expect(agentOnly.working).toBe(true); // agent not done
	});

	test("null tool log → empty, non-throwing feed", () => {
		const f = buildOpsFeed(
			deps({ toolLog: null, inFlight: [], agents: [] }),
			0,
		);
		expect(f.ops).toEqual([]);
		expect(f.topology[0].id).toBe("core");
		expect(f.working).toBe(false);
	});

	test("agent attribution: sub-agent sessions become non-zero tasks", () => {
		const agentSession = "agent-researcher-42";
		const f = buildOpsFeed(
			deps({
				toolLog: {
					query: () => [
						row(30, "gh_search", 4000, 100, 0, agentSession),
						row(31, "plan", 4000, 100, 0, "web-1"), // main session → core
					],
				},
				agents: [
					{
						id: agentSession,
						name: "researcher",
						task: "deep dig",
						done: false,
						ok: false,
						ageMs: 1000,
					},
				],
				inFlight: [],
			}),
			0,
		);
		const sub = f.ops.find((o) => o.op === "gh_search");
		expect(sub?.taskId).not.toBe(0);
		expect(sub?.taskLabel).toBe("deep dig");
		expect(sub?.session).toBe(agentSession);
		const main = f.ops.find((o) => o.op === "plan");
		expect(main?.taskId).toBe(0); // orchestrator / main session, not a budded agent
		expect(main?.taskLabel).toBe("");
	});

	test("finished sub-agent ops still attribute via the agent- prefix", () => {
		const f = buildOpsFeed(
			deps({
				toolLog: {
					query: () => [row(40, "icp_score", 3000, 100, 0, "agent-enricher-9")],
				},
				agents: [], // already pruned from kernel.activeAgents
				inFlight: [],
			}),
			0,
		);
		const op = f.ops.find((o) => o.op === "icp_score");
		expect(op?.taskId).not.toBe(0);
		expect(op?.taskLabel).toBe("sub-agent"); // no live label, but still a swarm agent
	});
});
