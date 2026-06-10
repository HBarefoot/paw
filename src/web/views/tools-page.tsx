import type { FC } from "hono/jsx";
import { Layout } from "./layout.js";

export interface ToolLogRow {
	id: number;
	tool_name: string;
	plugin: string | null;
	session_id: string | null;
	input_preview: string | null;
	output_preview: string | null;
	is_error: number;
	duration_ms: number | null;
	created_at: string;
}

export interface ToolsPageProps {
	rows: ToolLogRow[];
	tools: string[];
	summary: { total: number; errors: number; avgDurationMs: number | null };
	toolFilter?: string;
	errorsOnly?: boolean;
}

function previewCell(value: string | null): string {
	if (!value) return "";
	return value.length > 160 ? `${value.slice(0, 160)}…` : value;
}

function formatDuration(ms: number | null): string {
	if (ms == null) return "—";
	if (ms < 1000) return `${ms} ms`;
	if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
	return `${(ms / 60_000).toFixed(1)} min`;
}

export const ToolsPage: FC<ToolsPageProps> = ({
	rows,
	tools,
	summary,
	toolFilter,
	errorsOnly,
}) => {
	return (
		<Layout title="Tool Executions" currentPath="/tools">
			<div class="grid mb-md">
				<div class="card metric">
					<span class="m-label">Total calls</span>
					<span class="m-value">{summary.total}</span>
					<span class="m-sub">all tools · all time</span>
				</div>
				<div class="card metric">
					<span class="m-label">Errors</span>
					<span
						class="m-value"
						style={summary.errors > 0 ? "color:var(--danger)" : ""}
					>
						{summary.errors}
					</span>
					<span class="m-sub">
						{summary.total > 0 ? (
							<span class={summary.errors > 0 ? "m-delta-down" : "m-delta-up"}>
								{((summary.errors / summary.total) * 100).toFixed(1)}% error
								rate
							</span>
						) : (
							"no data"
						)}
					</span>
				</div>
				<div class="card metric">
					<span class="m-label">Avg duration</span>
					<span class="m-value">{formatDuration(summary.avgDurationMs)}</span>
					<span class="m-sub mono">p50 latency</span>
				</div>
			</div>

			<div class="card mb-md">
				<h3>Filter</h3>
				<form
					method="get"
					action="/tools"
					class="flex gap-sm items-end flex-wrap"
				>
					<div>
						<label for="tool">Tool</label>
						<select name="tool" id="tool">
							<option value="">All tools</option>
							{tools.map((t) => (
								<option value={t} selected={t === toolFilter}>
									{t}
								</option>
							))}
						</select>
					</div>
					<div>
						<label class="flex gap-sm items-center">
							<input
								type="checkbox"
								name="errors"
								value="1"
								checked={errorsOnly ?? false}
							/>
							<span>Errors only</span>
						</label>
					</div>
					<button type="submit" class="btn-primary">
						Apply
					</button>
					<a href="/tools" class="btn-secondary">
						Clear
					</a>
				</form>
			</div>

			<div class="card">
				<h3>Recent executions ({rows.length})</h3>
				{rows.length > 0 ? (
					<div class="audit-table-wrap">
						<table class="audit-table">
							<thead>
								<tr>
									<th>When</th>
									<th>Tool</th>
									<th>Plugin</th>
									<th>Duration</th>
									<th>Status</th>
									<th>Input</th>
									<th>Output</th>
								</tr>
							</thead>
							<tbody>
								{rows.map((r) => (
									<tr>
										<td>
											<time class="text-xs text-muted">{r.created_at}</time>
										</td>
										<td>
											<code>{r.tool_name}</code>
										</td>
										<td class="text-xs text-muted">{r.plugin ?? "—"}</td>
										<td class="text-xs">{formatDuration(r.duration_ms)}</td>
										<td>
											<span
												class={`badge ${r.is_error ? "danger" : "success"}`}
											>
												{r.is_error ? "error" : "ok"}
											</span>
										</td>
										<td class="audit-details" title={r.input_preview ?? ""}>
											{previewCell(r.input_preview)}
										</td>
										<td class="audit-details" title={r.output_preview ?? ""}>
											{previewCell(r.output_preview)}
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				) : (
					<div class="empty-state">
						<p>No tool executions recorded yet.</p>
					</div>
				)}
			</div>
		</Layout>
	);
};
