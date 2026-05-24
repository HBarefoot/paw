import type { FC } from "hono/jsx";
import { Layout } from "./layout.js";

export interface AuditRow {
	id: number;
	action: string;
	user_id: number | null;
	details: string | null;
	ip_address: string | null;
	created_at: string;
}

export interface AuditPageProps {
	rows: AuditRow[];
	actions: string[];
	actionFilter?: string;
	userFilter?: string;
}

function summarizeDetails(raw: string | null): string {
	if (!raw) return "";
	try {
		const parsed = JSON.parse(raw);
		return JSON.stringify(parsed, null, 0).slice(0, 240);
	} catch {
		return raw.slice(0, 240);
	}
}

export const AuditPage: FC<AuditPageProps> = ({
	rows,
	actions,
	actionFilter,
	userFilter,
}) => {
	return (
		<Layout title="Audit Log" currentPath="/audit">
			<div class="card mb-md">
				<h3>Filter</h3>
				<form
					method="get"
					action="/audit"
					class="flex gap-sm items-end flex-wrap"
				>
					<div>
						<label for="action">Action</label>
						<select name="action" id="action">
							<option value="">All actions</option>
							{actions.map((a) => (
								<option value={a} selected={a === actionFilter}>
									{a}
								</option>
							))}
						</select>
					</div>
					<div>
						<label for="user">User ID</label>
						<input
							type="number"
							name="user"
							id="user"
							value={userFilter ?? ""}
							placeholder="e.g. 1"
						/>
					</div>
					<button type="submit" class="btn-primary">
						Apply
					</button>
					<a href="/audit" class="btn-secondary">
						Clear
					</a>
				</form>
			</div>

			<div class="card">
				<h3>Recent events ({rows.length})</h3>
				{rows.length > 0 ? (
					<div class="audit-table-wrap">
						<table class="audit-table">
							<thead>
								<tr>
									<th>When</th>
									<th>Action</th>
									<th>User</th>
									<th>IP</th>
									<th>Details</th>
								</tr>
							</thead>
							<tbody>
								{rows.map((r) => (
									<tr>
										<td>
											<time class="text-xs text-muted">{r.created_at}</time>
										</td>
										<td>
											<span class="badge info">{r.action}</span>
										</td>
										<td class="text-sm">{r.user_id ?? "—"}</td>
										<td class="text-sm">{r.ip_address ?? "—"}</td>
										<td class="audit-details" title={r.details ?? ""}>
											{summarizeDetails(r.details)}
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				) : (
					<div class="empty-state">
						<p>No audit events recorded.</p>
					</div>
				)}
			</div>
		</Layout>
	);
};
