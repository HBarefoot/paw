import { raw } from "hono/html";
import type { FC } from "hono/jsx";
import type { NotificationRow } from "../../store/notifications.js";
import { Layout } from "./layout.js";

interface NotificationsPageProps {
	notifications: NotificationRow[];
	unread: number;
}

function levelBadge(level: string): string {
	if (level === "error") return "error";
	if (level === "warning") return "warning";
	if (level === "success") return "success";
	return "neutral";
}

export const NotificationsPage: FC<NotificationsPageProps> = ({
	notifications,
	unread,
}) => {
	return (
		<Layout title="Notifications" currentPath="/notifications">
			<div class="card mb-md">
				<h3 style="display:flex;align-items:center;justify-content:space-between;gap:8px">
					<span style="display:flex;align-items:center;gap:8px">
						Notifications
						{unread > 0 && <span class="badge accent">{unread} unread</span>}
					</span>
					{notifications.length > 0 && (
						<button
							type="button"
							class="btn btn-secondary btn-sm"
							onclick="notifMarkAll()"
						>
							Mark all read
						</button>
					)}
				</h3>
				<p class="text-sm text-muted">
					Proactive alerts the agent has for you — GitHub events, CI
					investigations, and more. Also shown as a sidebar badge and on the
					canvas portrait.
				</p>
				<div id="notif-list">
					{notifications.length === 0 && (
						<p class="text-sm text-muted">
							Nothing yet — you're all caught up.
						</p>
					)}
					{notifications.map((n) => (
						<div
							key={n.id}
							class="notif-item"
							data-id={n.id}
							style={`display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:11px;border:1px solid var(--border-primary);border-radius:9px;margin-bottom:8px;${n.read ? "opacity:.55" : ""}`}
						>
							<div style="min-width:0">
								<div style="display:flex;align-items:center;gap:8px">
									<span class={`badge ${levelBadge(n.level)}`}>{n.kind}</span>
									{n.url ? (
										<a
											class="link"
											href={n.url}
											target="_blank"
											rel="noreferrer noopener"
											style="font-weight:600"
										>
											{n.title}
										</a>
									) : (
										<strong>{n.title}</strong>
									)}
								</div>
								{n.body && (
									<div class="text-sm text-muted" style="margin-top:3px">
										{n.body}
									</div>
								)}
								<div class="text-sm text-muted" style="margin-top:2px">
									{n.created_at}
								</div>
							</div>
							{!n.read && (
								<button
									type="button"
									class="btn btn-secondary btn-sm"
									data-id={n.id}
									onclick="notifMarkOne(this.dataset.id)"
									style="flex-shrink:0"
								>
									Mark read
								</button>
							)}
						</div>
					))}
				</div>
			</div>

			{raw(`<script>
async function notifMarkOne(id) {
  try {
    await fetch("/api/notifications/read", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ id: id }) });
    window.location.reload();
  } catch (e) {}
}
async function notifMarkAll() {
  try {
    await fetch("/api/notifications/read", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({}) });
    window.location.reload();
  } catch (e) {}
}
</script>`)}
		</Layout>
	);
};
