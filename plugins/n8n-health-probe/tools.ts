import { sanitizePromptText } from "../../src/ai/system-prompt.js";
import type { ToolDefinition, ToolResult } from "../../src/types/message.js";
import { type N8nClient, isFailure } from "./client.js";

/**
 * n8n health-probe tools (read-only). Grouped under the on-demand
 * `n8n-health-probe` skill via `plugin: "n8n-health-probe"` — which is also the
 * permission the sandbox checks for these tool names (see manifest/README).
 *
 * `client` is null when n8n isn't configured; every tool then returns a clean
 * "not configured" error rather than throwing, so the orphan-sweep cron and the
 * agent degrade gracefully. Remote workflow names / error text are passed
 * through sanitizePromptText() before they re-enter the model.
 */
export function createTools(client: N8nClient | null): ToolDefinition[] {
	const HOUR = 3_600_000;
	const s = (v: string | undefined | null): string =>
		v ? sanitizePromptText(v) : "";

	const notConfigured: ToolResult = {
		content:
			"n8n is not configured. Set the `n8n-health-probe` config (baseUrl + token; token may be `vault://n8n.token` to reuse the n8n secret) or PAW_N8N_TOKEN + PAW_N8N_BASE_URL.",
		is_error: true,
	};
	const errResult = (err: unknown): ToolResult => ({
		content: `n8n error: ${err instanceof Error ? err.message : String(err)}`,
		is_error: true,
	});

	const probeWorkflow: ToolDefinition = {
		name: "probe_workflow",
		description:
			"Health-check one n8n workflow: active state, run count, failure rate, last run/status over a window, plus an actionable verdict.",
		plugin: "n8n-health-probe",
		input_schema: {
			type: "object",
			properties: {
				workflow_id: { type: "string", description: "n8n workflow id." },
				window_hours: {
					type: "number",
					description: "Look-back window in hours (default 24).",
				},
			},
			required: ["workflow_id"],
		},
		handler: async (input): Promise<ToolResult> => {
			if (!client) return notConfigured;
			const id = String(input.workflow_id);
			const windowHours = Number(input.window_hours) || 24;
			try {
				const wf = await client.getWorkflow(id);
				const exs =
					(await client.listExecutions({ workflowId: id, limit: 100 })).data ??
					[];
				const cutoff = Date.now() - windowHours * HOUR;
				const inWindow = exs.filter(
					(e) => e.startedAt && Date.parse(e.startedAt) >= cutoff,
				);
				const total = inWindow.length;
				const failures = inWindow.filter((e) => isFailure(e.status)).length;
				const failureRate = total ? failures / total : 0;
				let verdict: string;
				if (!wf.active) verdict = "disabled — the workflow is not active";
				else if (total === 0)
					verdict = `idle — no runs in the last ${windowHours}h`;
				else if (failureRate >= 0.5)
					verdict = `unhealthy — ${Math.round(failureRate * 100)}% of recent runs failed`;
				else if (failures > 0)
					verdict = `degraded — ${failures}/${total} recent runs failed`;
				else verdict = "healthy";
				return {
					content: JSON.stringify({
						workflowId: id,
						name: s(wf.name),
						active: wf.active,
						windowHours,
						total,
						failures,
						failureRate: Number(failureRate.toFixed(3)),
						lastRun: exs[0]?.startedAt ?? null,
						lastStatus: exs[0]?.status ?? null,
						verdict,
					}),
				};
			} catch (err) {
				return errResult(err);
			}
		},
	};

	const listInactive: ToolDefinition = {
		name: "list_inactive_workflows",
		description:
			"List n8n workflows with no successful activity in the window (disabled, never run, or stale). Returns {id, name, last_run, reason}.",
		plugin: "n8n-health-probe",
		input_schema: {
			type: "object",
			properties: {
				window_hours: {
					type: "number",
					description: "Inactivity threshold in hours (default 168 = 7 days).",
				},
			},
		},
		handler: async (input): Promise<ToolResult> => {
			if (!client) return notConfigured;
			const windowHours = Number(input.window_hours) || 168;
			try {
				const wfs = (await client.listWorkflows()).data ?? [];
				const exs = (await client.listExecutions({ limit: 250 })).data ?? [];
				// n8n returns executions most-recent first → first seen per workflow
				// is its latest run.
				const lastByWf = new Map<string, string>();
				for (const e of exs) {
					if (e.workflowId && e.startedAt && !lastByWf.has(e.workflowId)) {
						lastByWf.set(e.workflowId, e.startedAt);
					}
				}
				const cutoff = Date.now() - windowHours * HOUR;
				const inactive: Array<{
					id: string;
					name: string;
					last_run: string | null;
					reason: string;
				}> = [];
				for (const w of wfs) {
					const last = lastByWf.get(w.id) ?? null;
					if (!w.active) {
						inactive.push({
							id: w.id,
							name: s(w.name),
							last_run: last,
							reason: "disabled",
						});
					} else if (!last) {
						inactive.push({
							id: w.id,
							name: s(w.name),
							last_run: null,
							reason: `no runs in recent history (older than ${windowHours}h)`,
						});
					} else if (Date.parse(last) < cutoff) {
						inactive.push({
							id: w.id,
							name: s(w.name),
							last_run: last,
							reason: `last run is older than ${windowHours}h`,
						});
					}
				}
				return { content: JSON.stringify({ windowHours, inactive }) };
			} catch (err) {
				return errResult(err);
			}
		},
	};

	const recentFailures: ToolDefinition = {
		name: "recent_failures",
		description:
			"List the most recent failed n8n executions with the failing node and an error excerpt.",
		plugin: "n8n-health-probe",
		input_schema: {
			type: "object",
			properties: {
				limit: { type: "number", description: "Max failures (default 10)." },
			},
		},
		handler: async (input): Promise<ToolResult> => {
			if (!client) return notConfigured;
			const limit = Math.min(Number(input.limit) || 10, 50);
			try {
				const exs =
					(
						await client.listExecutions({
							status: "error",
							limit,
							includeData: true,
						})
					).data ?? [];
				const wfs = (await client.listWorkflows()).data ?? [];
				const nameById = new Map(wfs.map((w) => [w.id, w.name]));
				const failures = exs.map((e) => {
					const rd = e.data?.resultData;
					const failedNode =
						rd?.error?.node?.name ?? rd?.lastNodeExecuted ?? null;
					return {
						executionId: e.id,
						workflowId: e.workflowId,
						workflowName: s(nameById.get(e.workflowId) ?? ""),
						failedNode: failedNode ? s(failedNode) : null,
						error: rd?.error?.message ? s(rd.error.message) : null,
						startedAt: e.startedAt ?? null,
					};
				});
				return { content: JSON.stringify({ failures }) };
			} catch (err) {
				return errResult(err);
			}
		},
	};

	return [probeWorkflow, listInactive, recentFailures];
}
