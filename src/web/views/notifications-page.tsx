import { raw } from "hono/html";
import type { FC } from "hono/jsx";
import type { NotificationRow } from "../../store/notifications.js";
import { icon } from "./icons.js";
import { Layout } from "./layout.js";

interface NotificationsPageProps {
	notifications: NotificationRow[];
	unread: number;
}

// Map a notification level → design icon + accent class for the .nicon tile.
function levelVisual(level: string): { icon: string; tone: string } {
	if (level === "error") return { icon: "alert", tone: "red" };
	if (level === "warning") return { icon: "shield", tone: "amber" };
	if (level === "success") return { icon: "checkCircle", tone: "green" };
	return { icon: "info", tone: "cyan" };
}

const toneColor: Record<string, string> = {
	red: "var(--red)",
	amber: "var(--amber)",
	green: "var(--green)",
	cyan: "var(--cyan)",
};

export function notificationsScript(): string {
	return `
    function notifOnlyUnread(btn) {
      var on = btn.classList.toggle("on");
      var rows = document.querySelectorAll("#notif-list .notif");
      for (var i = 0; i < rows.length; i++) {
        var unread = rows[i].getAttribute("data-read") === "0";
        rows[i].style.display = (on && !unread) ? "none" : "";
      }
    }
    async function notifMarkOne(id) {
      try {
        await fetch("/api/notifications/read", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: id }) });
        window.location.reload();
      } catch (e) {}
    }
    async function notifMarkAll() {
      try {
        await fetch("/api/notifications/read", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
        window.location.reload();
      } catch (e) {}
    }
  `;
}

// Exposed for the cook+run template-trap test.
export function getNotificationsScript(): string {
	return notificationsScript();
}

export const NotificationsPage: FC<NotificationsPageProps> = ({
	notifications,
	unread,
}) => {
	return (
		<Layout title="Notifications" currentPath="/notifications">
			<div class="page-grid" style="max-width:820px;margin:0 auto;width:100%">
				<div class="section-hd">
					<h2 style="display:flex;align-items:center;gap:10px">
						Notifications
						{unread > 0 && (
							<span class="pill-badge green">{unread} unread</span>
						)}
					</h2>
					<div style="display:flex;gap:8px">
						<button
							type="button"
							class="btn-secondary btn-sm"
							onclick="notifOnlyUnread(this)"
						>
							{raw(icon("filter", 13))} Unread only
						</button>
						{notifications.length > 0 && (
							<button
								type="button"
								class="btn-secondary btn-sm"
								onclick="notifMarkAll()"
							>
								{raw(icon("check", 13))} Mark all read
							</button>
						)}
					</div>
				</div>

				<div class="panel">
					<div class="panel-bd tight" id="notif-list">
						{notifications.length === 0 ? (
							<div class="empty-state">
								{raw(icon("bell", 30))}
								<div class="t">You're all caught up</div>
								<div class="s">No notifications right now.</div>
							</div>
						) : (
							notifications.map((n) => {
								const v = levelVisual(n.level);
								return (
									<div
										key={n.id}
										class={`notif${n.read ? "" : " unread"}`}
										data-read={n.read ? "1" : "0"}
									>
										<div class="nicon" style={`color:${toneColor[v.tone]}`}>
											{raw(icon(v.icon, 16))}
										</div>
										<div class="nbody">
											<div
												class="nt"
												style="display:flex;align-items:center;gap:8px"
											>
												<span class="pill-badge dim">{n.kind}</span>
												{n.url ? (
													<a
														class="link"
														href={n.url}
														target="_blank"
														rel="noreferrer noopener"
														style="color:var(--ink-bright)"
													>
														{n.title}
													</a>
												) : (
													n.title
												)}
											</div>
											{n.body && <div class="ns">{n.body}</div>}
										</div>
										<div style="display:flex;flex-direction:column;align-items:flex-end;gap:8px">
											<span class="ntime">{n.created_at}</span>
											<div style="display:flex;gap:4px">
												{!n.read && (
													<button
														type="button"
														class="icobtn"
														title="Mark read"
														data-id={n.id}
														onclick="notifMarkOne(this.dataset.id)"
													>
														{raw(icon("check", 14))}
													</button>
												)}
											</div>
										</div>
									</div>
								);
							})
						)}
					</div>
				</div>
			</div>

			{raw(`<script>${notificationsScript()}</script>`)}
		</Layout>
	);
};
