import { raw } from "hono/html";
import type { FC } from "hono/jsx";
import { Layout } from "./layout.js";

interface Webhook {
	id: string;
	name: string;
	slug: string;
	secret: string | null;
	description: string;
	event_type: string;
	active: number;
	last_triggered_at: string | null;
	trigger_count: number;
	created_at: string;
}

interface WebhooksPageProps {
	webhooks: Webhook[];
	baseUrl: string;
	error?: string;
	success?: string;
}

function webhooksScript(): string {
	return `
    async function createWebhook() {
      var name = await pawModal.prompt("New Webhook", "Enter a name for this webhook:", "");
      if (!name) return;
      var slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      slug = await pawModal.prompt("Webhook Slug", "URL-safe slug (lowercase, hyphens):", slug);
      if (!slug) return;
      var res = await fetch("/api/webhooks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name, slug: slug })
      });
      var data = await res.json();
      if (!res.ok) { pawModal.alert("Error", data.error || "Failed to create webhook"); return; }
      window.location.reload();
    }

    async function deleteWebhook(id, name) {
      var ok = await pawModal.confirm("Delete Webhook", 'Delete webhook "' + name + '"? This cannot be undone.', { confirmLabel: "Delete", danger: true });
      if (!ok) return;
      var res = await fetch("/api/webhooks/" + id, { method: "DELETE" });
      if (res.ok) window.location.reload();
      else pawModal.alert("Error", "Failed to delete webhook.");
    }

    async function toggleWebhook(id, active) {
      await fetch("/api/webhooks/" + id, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !active })
      });
      window.location.reload();
    }

    async function testWebhook(id) {
      var btn = event.target;
      btn.disabled = true;
      btn.textContent = "Sending...";
      var res = await fetch("/api/webhooks/" + id + "/test", { method: "POST" });
      if (res.ok) {
        btn.textContent = "Sent!";
        setTimeout(function() { btn.disabled = false; btn.textContent = "Test"; }, 2000);
      } else {
        pawModal.alert("Error", "Test failed.");
        btn.disabled = false;
        btn.textContent = "Test";
      }
    }

    function copyUrl(text) {
      navigator.clipboard.writeText(text).then(function() {
        pawModal.alert("Copied", "Webhook URL copied to clipboard.");
      });
    }
  `;
}

export const WebhooksPage: FC<WebhooksPageProps> = ({
	webhooks,
	baseUrl,
	error,
	success,
}) => {
	const activeCount = webhooks.filter((w) => w.active).length;
	const totalTriggers = webhooks.reduce((sum, w) => sum + w.trigger_count, 0);

	return (
		<Layout title="Webhooks" currentPath="/webhooks">
			{error && <div class="alert alert-error">{error}</div>}
			{success && <div class="alert alert-success">{success}</div>}

			<div class="grid mb-md">
				<div class="card">
					<h3>Webhooks</h3>
					<div class="stat-value">
						{activeCount}/{webhooks.length}
					</div>
					<div class="stat-label">active</div>
				</div>
				<div class="card">
					<h3>Total Triggers</h3>
					<div class="stat-value">{totalTriggers}</div>
				</div>
			</div>

			<div class="flex justify-between items-center mb-md">
				<div />
				{raw(
					`<button class="btn-primary" onclick="createWebhook()">+ New Webhook</button>`,
				)}
			</div>

			{webhooks.length === 0 && (
				<div class="card">
					<div class="empty-state">
						<div class="empty-icon">&#128268;</div>
						<p>
							No webhooks configured yet. Create one to receive events from
							external services.
						</p>
					</div>
				</div>
			)}

			{webhooks.map((webhook) => {
				const webhookUrl = `${baseUrl}/api/webhooks/incoming/${webhook.slug}`;
				return (
					<div class="card mb-md" key={webhook.id}>
						<div class="flex justify-between items-center mb-md">
							<h3 class="card-title">{webhook.name}</h3>
							<div class="flex gap-sm items-center">
								<span class={`badge ${webhook.active ? "success" : "neutral"}`}>
									{webhook.active ? "Active" : "Inactive"}
								</span>
								<span class="badge info">{webhook.event_type}</span>
							</div>
						</div>
						{webhook.description && (
							<p class="text-sm text-muted mb-md">{webhook.description}</p>
						)}
						<div class="flex gap-sm items-center mb-md">
							<code style="flex:1;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
								POST {webhookUrl}
							</code>
							{raw(
								`<button class="btn-ghost btn-sm" onclick="copyUrl('${webhookUrl}')">Copy</button>`,
							)}
						</div>
						<div class="flex justify-between items-center">
							<div class="flex gap-sm items-center">
								<span class="text-xs text-muted">
									Triggers: {webhook.trigger_count}
								</span>
								{webhook.last_triggered_at && (
									<span class="text-xs text-muted">
										Last:{" "}
										{new Date(`${webhook.last_triggered_at}Z`).toLocaleString()}
									</span>
								)}
							</div>
							<div class="flex gap-sm">
								{raw(
									`<button class="btn-ghost btn-sm" onclick="testWebhook('${webhook.id}')">Test</button>`,
								)}
								{raw(
									`<button class="btn-ghost btn-sm" onclick="toggleWebhook('${webhook.id}', ${webhook.active ? "true" : "false"})">${webhook.active ? "Disable" : "Enable"}</button>`,
								)}
								{raw(
									`<button class="btn-danger btn-sm" onclick="deleteWebhook('${webhook.id}', '${webhook.name.replace(/'/g, "\\'")}')">Delete</button>`,
								)}
							</div>
						</div>
					</div>
				);
			})}

			{raw(`<script>${webhooksScript()}</script>`)}
		</Layout>
	);
};
