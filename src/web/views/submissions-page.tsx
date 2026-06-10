import type { FC } from "hono/jsx";
import { Layout } from "./layout.js";

export interface CanvasAction {
	id: string;
	name: string;
	type: string;
	config_json: string;
	submit_count: number;
	active: number;
	created_at: string;
}

export interface CanvasSubmission {
	id: number;
	action_id: string;
	action_name: string | null;
	data_json: string;
	status: string;
	target_ref: string | null;
	created_at: string;
}

interface SubmissionsPageProps {
	actions: CanvasAction[];
	submissions: CanvasSubmission[];
	actionFilter?: string;
}

function statusClass(status: string): string {
	if (status === "routed") return "badge-success";
	if (status === "failed") return "badge-danger";
	return "badge-warning";
}

function targetLabel(a: CanvasAction): string {
	try {
		const cfg = JSON.parse(a.config_json || "{}");
		if (a.type === "strapi") return `strapi · ${cfg.contentType ?? "?"}`;
		if (a.type === "hubspot") return "hubspot · contacts";
	} catch {
		// ignore
	}
	return a.type;
}

function previewData(json: string): string {
	try {
		const obj = JSON.parse(json) as Record<string, unknown>;
		return Object.entries(obj)
			.map(([k, v]) => `${k}: ${String(v)}`)
			.join(" · ")
			.slice(0, 140);
	} catch {
		return "";
	}
}

export const SubmissionsPage: FC<SubmissionsPageProps> = ({
	actions,
	submissions,
	actionFilter,
}) => {
	return (
		<Layout title="Submissions" currentPath="/submissions">
			<p class="text-secondary mb-md" style="max-width:640px">
				Form submissions captured from your canvas pages. Every submission is
				recorded here (the durable inbox) and routed to its wired destination —
				so leads are never lost, and you can see exactly where each one went.
			</p>

			<div class="card">
				<h3>Action bindings ({actions.length})</h3>
				{actions.length > 0 ? (
					<table>
						<thead>
							<tr>
								<th>Name</th>
								<th>Destination</th>
								<th>Submissions</th>
								<th>Status</th>
								<th>Submit URL</th>
							</tr>
						</thead>
						<tbody>
							{actions.map((a) => (
								<tr>
									<td>{a.name}</td>
									<td class="mono">{targetLabel(a)}</td>
									<td class="mono">{a.submit_count}</td>
									<td>
										<span
											class={`badge ${a.active ? "badge-success" : "badge-neutral"}`}
										>
											{a.active ? "active" : "off"}
										</span>
									</td>
									<td>
										<code>/api/forms/{a.id}</code>
									</td>
								</tr>
							))}
						</tbody>
					</table>
				) : (
					<div class="empty-state">
						<p>
							No action bindings yet. In Chat → Canvas, ask Paw to build a page
							with a form wired to Strapi or HubSpot — it will create a binding
							here automatically.
						</p>
					</div>
				)}
			</div>

			<div class="card">
				<div class="flex justify-between items-center mb-md">
					<h3 style="margin:0">Submissions inbox ({submissions.length})</h3>
					{actionFilter && (
						<a href="/submissions" class="badge badge-accent">
							filtered · clear
						</a>
					)}
				</div>
				{submissions.length > 0 ? (
					<div class="audit-table-wrap">
						<table>
							<thead>
								<tr>
									<th>When</th>
									<th>Form</th>
									<th>Data</th>
									<th>Status</th>
									<th>Target ref</th>
								</tr>
							</thead>
							<tbody>
								{submissions.map((s) => (
									<tr>
										<td class="text-xs text-muted mono">{s.created_at}</td>
										<td>{s.action_name ?? s.action_id}</td>
										<td class="text-xs">{previewData(s.data_json)}</td>
										<td>
											<span class={`badge ${statusClass(s.status)}`}>
												{s.status}
											</span>
										</td>
										<td class="text-xs mono text-muted">
											{s.target_ref ?? "—"}
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				) : (
					<div class="empty-state">
						<p>No submissions captured yet.</p>
					</div>
				)}
			</div>
		</Layout>
	);
};
