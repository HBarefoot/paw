import type { Database } from "bun:sqlite";
import { getSessionWithMessages } from "../store/sessions.js";

export type ExportFormat = "md" | "html" | "json";

export interface ExportResult {
	filename: string;
	contentType: string;
	body: string;
}

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

function slugify(value: string): string {
	return value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 64);
}

/**
 * Serialize a full conversation in the requested format. Returns null when
 * the session doesn't exist.
 */
export function exportSession(
	db: Database,
	sessionId: string,
	format: ExportFormat,
): ExportResult | null {
	const data = getSessionWithMessages(db, sessionId);
	if (!data) return null;

	const title =
		data.session.title ||
		`Conversation ${data.session.id.slice(0, 8)}`;
	const base = slugify(title) || "conversation";

	if (format === "json") {
		return {
			filename: `${base}.json`,
			contentType: "application/json; charset=utf-8",
			body: JSON.stringify(
				{
					session: data.session,
					messages: data.messages,
				},
				null,
				2,
			),
		};
	}

	if (format === "md") {
		const lines: string[] = [];
		lines.push(`# ${title}`);
		lines.push("");
		lines.push(`- Session ID: \`${data.session.id}\``);
		lines.push(`- Channel: \`${data.session.channel}\``);
		lines.push(`- Created: ${data.session.created_at}`);
		lines.push(`- Messages: ${data.messages.length}`);
		lines.push("");
		lines.push("---");
		lines.push("");
		for (const msg of data.messages) {
			const role =
				msg.role.charAt(0).toUpperCase() + msg.role.slice(1);
			lines.push(`## ${role} — ${msg.created_at}`);
			lines.push("");
			lines.push(msg.content);
			lines.push("");
		}
		return {
			filename: `${base}.md`,
			contentType: "text/markdown; charset=utf-8",
			body: lines.join("\n"),
		};
	}

	// HTML: self-contained, printable document.
	const messagesHtml = data.messages
		.map((msg) => {
			const role = escapeHtml(msg.role);
			const time = escapeHtml(msg.created_at);
			const content = escapeHtml(msg.content).replace(/\n/g, "<br>");
			return `<article class="msg role-${role}"><header><strong>${role}</strong> <time>${time}</time></header><div class="body">${content}</div></article>`;
		})
		.join("\n");

	const body = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 15px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; margin: 0; padding: 24px; max-width: 780px; margin: 0 auto; }
  h1 { font-size: 22px; margin: 0 0 8px; }
  .meta { color: #666; font-size: 13px; margin-bottom: 24px; }
  .msg { padding: 12px 16px; border-radius: 10px; margin: 12px 0; border: 1px solid #e2e8f0; }
  .msg header { font-size: 12px; color: #666; margin-bottom: 6px; }
  .msg time { margin-left: 8px; }
  .role-user { background: #eef4fb; }
  .role-assistant { background: #fff; }
  .role-tool { background: #fafafa; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; }
  @media print { .msg { break-inside: avoid; } }
</style>
</head>
<body>
<h1>${escapeHtml(title)}</h1>
<div class="meta">
  Session ID: <code>${escapeHtml(data.session.id)}</code> · Channel: ${escapeHtml(data.session.channel)} · ${data.messages.length} messages · Created ${escapeHtml(data.session.created_at)}
</div>
${messagesHtml}
</body>
</html>`;

	return {
		filename: `${base}.html`,
		contentType: "text/html; charset=utf-8",
		body,
	};
}
