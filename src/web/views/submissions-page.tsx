import { raw } from "hono/html";
import type { FC } from "hono/jsx";
import { icon } from "./icons.js";
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

function statusTone(status: string): string {
	if (status === "routed") return "green";
	if (status === "failed") return "red";
	return "amber";
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
			.slice(0, 120);
	} catch {
		return "";
	}
}

export function submissionsScript(): string {
	return `
    var subActiveStatus = "all";

    function subFilter() {
      var q = (document.getElementById("sub-search").value || "").toLowerCase();
      var rows = document.querySelectorAll("#sub-list .lrow");
      var shown = 0;
      for (var i = 0; i < rows.length; i++) {
        var row = rows[i];
        var statusOk = subActiveStatus === "all" || row.getAttribute("data-status") === subActiveStatus;
        var textOk = !q || (row.getAttribute("data-search") || "").indexOf(q) !== -1;
        var on = statusOk && textOk;
        row.style.display = on ? "" : "none";
        if (on) shown++;
      }
      var empty = document.getElementById("sub-empty");
      if (empty) empty.style.display = shown === 0 ? "" : "none";
    }

    function subSetStatus(btn, status) {
      subActiveStatus = status;
      var btns = btn.parentElement.querySelectorAll("button");
      for (var i = 0; i < btns.length; i++) btns[i].classList.remove("on");
      btn.classList.add("on");
      subFilter();
    }

    function kvRow(k, v) {
      var row = document.createElement("div");
      row.className = "kv";
      var kk = document.createElement("span");
      kk.className = "k";
      kk.textContent = k;
      var vv = document.createElement("span");
      vv.className = "v";
      vv.textContent = v;
      row.appendChild(kk);
      row.appendChild(vv);
      return row;
    }

    window.__subCurrent = null;

    function selectSub(el) {
      var rows = document.querySelectorAll("#sub-list .lrow");
      for (var i = 0; i < rows.length; i++) rows[i].classList.remove("sel");
      el.classList.add("sel");
      window.__subCurrent = el.getAttribute("data-json");
      var panel = document.getElementById("sub-detail");
      var ttl = document.getElementById("sub-detail-title");
      var meta = document.getElementById("sub-detail-meta");
      var bd = document.getElementById("sub-detail-body");
      ttl.textContent = el.getAttribute("data-form") || "Submission";
      var status = el.getAttribute("data-status");
      var tones = { routed: "green", failed: "red" };
      meta.className = "pill-badge " + (tones[status] || "amber");
      meta.textContent = status;
      bd.innerHTML = "";
      var obj = {};
      try { obj = JSON.parse(el.getAttribute("data-json") || "{}"); } catch (e) {}
      var keys = Object.keys(obj);
      for (var j = 0; j < keys.length; j++) bd.appendChild(kvRow(keys[j], String(obj[keys[j]])));
      bd.appendChild(kvRow("Received", el.getAttribute("data-when")));
      var ref = el.getAttribute("data-target");
      if (ref) bd.appendChild(kvRow("Target ref", ref));
      panel.style.display = "";
      document.getElementById("sub-placeholder").style.display = "none";
    }

    function exportSub() {
      if (!window.__subCurrent) return;
      var blob = new Blob([window.__subCurrent], { type: "application/json" });
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url;
      a.download = "submission.json";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      if (window.pawToast) pawToast("Exported as JSON", "download");
    }
  `;
}

// Exposed for the cook+run template-trap test.
export function getSubmissionsScript(): string {
	return submissionsScript();
}

export const SubmissionsPage: FC<SubmissionsPageProps> = ({
	actions,
	submissions,
	actionFilter,
}) => {
	const routed = submissions.filter((s) => s.status === "routed").length;
	const failed = submissions.filter((s) => s.status === "failed").length;
	return (
		<Layout title="Submissions" currentPath="/submissions">
			<div class="page-grid">
				<div class="kpi-strip cols-4">
					<div class="kpi">
						<div class="k">{raw(icon("flow", 13))} Bindings</div>
						<div class="v">{actions.length}</div>
						<div class="foot" />
					</div>
					<div class="kpi">
						<div class="k">{raw(icon("submissions", 13))} Submissions</div>
						<div class="v">{submissions.length}</div>
						<div class="foot" />
					</div>
					<div class="kpi">
						<div class="k">{raw(icon("check", 13))} Routed</div>
						<div class="v ok">{routed}</div>
						<div class="foot" />
					</div>
					<div class="kpi">
						<div class="k">{raw(icon("alert", 13))} Failed</div>
						<div class={`v${failed > 0 ? " err" : ""}`}>{failed}</div>
						<div class="foot" />
					</div>
				</div>

				<div class="panel">
					<div class="panel-hd">
						<div class="ttl">
							<span class="ico">{raw(icon("flow", 16))}</span>
							Action bindings
						</div>
						<span class="meta">{actions.length} wired</span>
					</div>
					<div class="panel-bd tight">
						{actions.length > 0 ? (
							<table class="tbl">
								<thead>
									<tr>
										<th>Name</th>
										<th>Destination</th>
										<th class="num">Submissions</th>
										<th>Status</th>
										<th>Submit URL</th>
									</tr>
								</thead>
								<tbody>
									{actions.map((a) => (
										<tr key={a.id}>
											<td>
												<span class="nm">{a.name}</span>
											</td>
											<td class="mono dim">{targetLabel(a)}</td>
											<td class="num">{a.submit_count}</td>
											<td>
												<span
													class={`pill-badge ${a.active ? "green" : "dim"}`}
												>
													{a.active ? "active" : "off"}
												</span>
											</td>
											<td class="mono dim">/api/forms/{a.id}</td>
										</tr>
									))}
								</tbody>
							</table>
						) : (
							<div class="empty-state">
								{raw(icon("flow", 30))}
								<div class="t">No action bindings yet</div>
								<div class="s">
									In Command Center → Canvas, ask Paw to build a page with a
									form wired to Strapi or HubSpot.
								</div>
							</div>
						)}
					</div>
				</div>

				<div class="split">
					<div class="panel">
						<div class="panel-hd">
							<div class="ttl">
								<span class="ico">{raw(icon("submissions", 16))}</span>
								Inbox
							</div>
							<div class="seg">
								<button
									type="button"
									class="on"
									onclick="subSetStatus(this,'all')"
								>
									All
								</button>
								<button type="button" onclick="subSetStatus(this,'routed')">
									Routed
								</button>
								<button type="button" onclick="subSetStatus(this,'failed')">
									Failed
								</button>
							</div>
						</div>
						<div style="padding:10px 12px;border-bottom:1px solid var(--line)">
							<div class="search-box">
								{raw(icon("search", 15))}
								<input
									id="sub-search"
									type="search"
									placeholder="Search submissions…"
									oninput="subFilter()"
								/>
							</div>
						</div>
						<div class="panel-bd tight" id="sub-list">
							{submissions.map((s) => (
								<div
									key={s.id}
									class="lrow"
									style="cursor:pointer"
									data-status={s.status}
									data-form={s.action_name ?? s.action_id}
									data-json={s.data_json}
									data-target={s.target_ref ?? ""}
									data-when={s.created_at}
									data-search={`${s.action_name ?? s.action_id} ${previewData(s.data_json)}`.toLowerCase()}
									onclick="selectSub(this)"
								>
									<span
										class={`led ${statusTone(s.status) === "green" ? "live" : statusTone(s.status) === "red" ? "err" : "warn"}`}
									/>
									<div style="flex:1;min-width:0">
										<div style="display:flex;justify-content:space-between;gap:8px">
											<span style="color:var(--ink-bright)">
												{s.action_name ?? s.action_id}
											</span>
											<span
												class="dim"
												style="font-size:10.5px;white-space:nowrap"
											>
												{s.created_at}
											</span>
										</div>
										<div
											class="dim"
											style="font-size:11px;margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis"
										>
											{previewData(s.data_json)}
										</div>
									</div>
								</div>
							))}
							<div
								class="empty-state"
								id="sub-empty"
								style={submissions.length === 0 ? "" : "display:none"}
							>
								{raw(icon("submissions", 30))}
								<div class="t">No submissions captured yet</div>
							</div>
						</div>
					</div>

					<div>
						<div class="panel" id="sub-placeholder">
							<div class="panel-hd">
								<div class="ttl">
									<span class="ico">{raw(icon("mail", 16))}</span>
									Detail
								</div>
							</div>
							<div class="panel-bd">
								<div class="empty-state">
									{raw(icon("submissions", 30))}
									<div class="t">Select a submission</div>
								</div>
							</div>
						</div>

						<div class="panel" id="sub-detail" style="display:none">
							<div class="panel-hd">
								<div class="ttl">
									<span class="ico">{raw(icon("mail", 16))}</span>
									<span id="sub-detail-title">Submission</span>
								</div>
								<span class="pill-badge dim" id="sub-detail-meta" />
							</div>
							<div class="panel-bd">
								<div class="detail" id="sub-detail-body" />
								<div style="display:flex;gap:8px;margin-top:16px">
									<a class="btn-primary btn-sm" href="/chat">
										{raw(icon("send", 13))} Reply in Command Center
									</a>
									<button
										type="button"
										class="btn-secondary btn-sm"
										onclick="exportSub()"
									>
										{raw(icon("download", 13))} Export
									</button>
								</div>
							</div>
						</div>
					</div>
				</div>
			</div>

			{actionFilter && (
				<a href="/submissions" class="pill-badge dim" style="margin-top:8px">
					filtered · clear
				</a>
			)}

			{raw(`<script>${submissionsScript()}</script>`)}
		</Layout>
	);
};
