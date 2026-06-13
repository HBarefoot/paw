import { raw } from "hono/html";
import type { FC } from "hono/jsx";
import { extractCanvasRequest } from "../../store/session-title.js";
import { Layout } from "./layout.js";

interface SessionSummary {
	id: string;
	channel: string;
	user_id: string;
	title: string | null;
	message_count: number;
	created_at: string;
	updated_at: string;
}

interface SessionMessage {
	id: string;
	role: string;
	content: string;
	created_at: string;
}

interface SessionsListProps {
	sessions: SessionSummary[];
}

interface SessionDetailProps {
	session: {
		id: string;
		channel: string;
		user_id: string;
		created_at: string;
		updated_at: string;
	};
	messages: SessionMessage[];
}

export const SessionsListPage: FC<SessionsListProps> = ({ sessions }) => {
	return (
		<Layout title="Conversation History" currentPath="/sessions">
			<div class="card">
				<h3>Recent Sessions ({sessions.length})</h3>
				{sessions.length > 0 ? (
					<table>
						<thead>
							<tr>
								<th>Session</th>
								<th>Title</th>
								<th>Channel</th>
								<th>User</th>
								<th>Messages</th>
								<th>Created</th>
								<th>Last Activity</th>
								<th />
							</tr>
						</thead>
						<tbody>
							{sessions.map((s) => (
								<tr key={s.id} id={`row-${s.id}`}>
									<td>
										<a href={`/sessions/${s.id}`} class="link">
											{s.id.length > 24 ? `${s.id.slice(0, 24)}...` : s.id}
										</a>
									</td>
									<td>{s.title ?? "\u2014"}</td>
									<td>
										<span class="badge neutral">{s.channel}</span>
									</td>
									<td>{s.user_id}</td>
									<td>{s.message_count}</td>
									<td>{s.created_at}</td>
									<td>{s.updated_at}</td>
									<td>
										<a
											href={`/chat?session=${s.id}`}
											class="link"
											style="margin-right:8px"
											title="Resume"
										>
											Resume
										</a>
										{raw(
											`<button class="btn-danger btn-sm" onclick="deleteSession('${s.id}')">Delete</button>`,
										)}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				) : (
					<div class="empty-state">
						<p>No conversation history yet.</p>
					</div>
				)}
			</div>
			{raw(`<script>
async function deleteSession(id) {
  var ok = await pawModal.confirm("Delete Session", "Delete this session and all its messages?", { confirmLabel: "Delete", danger: true });
  if (!ok) return;
  fetch("/api/sessions/" + id, { method: "DELETE" })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (data.deleted) {
        var row = document.getElementById("row-" + id);
        if (row) row.remove();
      }
    });
}
</script>`)}
		</Layout>
	);
};

function extractUserContent(content: string): {
	label: string | null;
	text: string;
} {
	// Canvas messages wrap the real ask in the [CANVAS MODE] system prompt; reuse
	// the shared extractor (single source of truth) to surface just the request.
	const req = extractCanvasRequest(content);
	if (req != null)
		return { label: "Canvas", text: req || "(see attached files)" };
	return { label: null, text: content };
}

const MSG_TRUNCATE_LEN = 600;

function sessionDetailScript(): string {
	return `(function() {
  // Collapsible long messages
  document.querySelectorAll("[data-truncated]").forEach(function(el) {
    var full = el.querySelector(".msg-full");
    var short = el.querySelector(".msg-short");
    var btn = el.querySelector(".msg-toggle");
    if (!full || !short || !btn) return;
    btn.addEventListener("click", function() {
      var expanded = full.style.display !== "none";
      full.style.display = expanded ? "none" : "block";
      short.style.display = expanded ? "block" : "none";
      btn.textContent = expanded ? "Show more" : "Show less";
    });
  });

  function esc(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function renderMarkdown(src) {
    var text = src.replace(/\\r\\n/g, "\\n").replace(/\\r/g, "\\n");

    var codeBlocks = [];
    text = text.replace(/\`\`\`([\\s\\S]*?)\`\`\`/g, function(m, code) {
      var lines = code.split("\\n");
      var lang = lines[0].trim();
      var body = lang ? lines.slice(1).join("\\n") : code;
      if (lang && body.charAt(0) === "\\n") body = body.substring(1);
      if (!lang && body.charAt(0) === "\\n") body = body.substring(1);
      codeBlocks.push('<pre><code' + (lang ? ' class="language-' + esc(lang) + '"' : '') + '>' + esc(body.replace(/\\n$/, "")) + '</code></pre>');
      return "%%CODEBLOCK_" + (codeBlocks.length - 1) + "%%";
    });

    var lines = text.split("\\n");
    var html = [];
    var i = 0;
    var inList = false;
    var listType = "";

    function closePendingList() {
      if (inList) { html.push("</" + listType + ">"); inList = false; listType = ""; }
    }

    while (i < lines.length) {
      var line = lines[i];
      if (/^(\\s*[-*_]\\s*){3,}$/.test(line)) { closePendingList(); html.push("<hr>"); i++; continue; }
      var hMatch = line.match(/^(#{1,6})\\s+(.+)$/);
      if (hMatch) { closePendingList(); var level = hMatch[1].length; html.push("<h" + level + ">" + inlineMarkdown(hMatch[2]) + "</h" + level + ">"); i++; continue; }
      var ulMatch = line.match(/^\\s*[-*+]\\s+(.+)$/);
      if (ulMatch) { if (!inList || listType !== "ul") { closePendingList(); html.push("<ul>"); inList = true; listType = "ul"; } html.push("<li>" + inlineMarkdown(ulMatch[1]) + "</li>"); i++; continue; }
      var olMatch = line.match(/^\\s*\\d+[.)\\s]\\s*(.+)$/);
      if (olMatch) { if (!inList || listType !== "ol") { closePendingList(); html.push("<ol>"); inList = true; listType = "ol"; } html.push("<li>" + inlineMarkdown(olMatch[1]) + "</li>"); i++; continue; }
      if (line.match(/^>\\s?/)) { closePendingList(); var bqLines = []; while (i < lines.length && lines[i].match(/^>\\s?/)) { bqLines.push(lines[i].replace(/^>\\s?/, "")); i++; } html.push("<blockquote>" + inlineMarkdown(bqLines.join("<br>")) + "</blockquote>"); continue; }
      if (line.match(/^%%CODEBLOCK_\\d+%%$/)) { closePendingList(); var idx = parseInt(line.match(/\\d+/)[0]); html.push(codeBlocks[idx]); i++; continue; }
      if (line.trim() === "") { closePendingList(); i++; continue; }
      closePendingList();
      var paraLines = [];
      while (i < lines.length) {
        var pl = lines[i];
        if (pl.trim() === "" || pl.match(/^#{1,6}\\s/) || pl.match(/^\\s*[-*+]\\s+/) || pl.match(/^\\s*\\d+[.)\\s]\\s/) || pl.match(/^>\\s?/) || pl.match(/^%%CODEBLOCK_/) || pl.match(/^(\\s*[-*_]\\s*){3,}$/)) break;
        paraLines.push(pl); i++;
      }
      html.push("<p>" + inlineMarkdown(paraLines.join("<br>")) + "</p>");
    }
    closePendingList();
    return html.join("\\n");
  }

  function inlineMarkdown(text) {
    var codes = [];
    var s = text.replace(/\`([^\`]+)\`/g, function(m, c) { codes.push('<code>' + esc(c) + '</code>'); return "%%INLINE_" + (codes.length - 1) + "%%"; });
    s = esc(s);
    s = s.replace(/&lt;br\\s*\\/?&gt;/gi, "<br>");
    s = s.replace(/\\*\\*\\*(.+?)\\*\\*\\*/g, "<strong><em>$1</em></strong>");
    s = s.replace(/\\*\\*(.+?)\\*\\*/g, "<strong>$1</strong>");
    s = s.replace(/\\*(.+?)\\*/g, "<em>$1</em>");
    s = s.replace(/~~(.+?)~~/g, "<del>$1</del>");
    s = s.replace(/\\[([^\\]]+)\\]\\(([^)]+)\\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    s = s.replace(/%%INLINE_(\\d+)%%/g, function(m, idx) { return codes[parseInt(idx)]; });
    return s;
  }

  // Render markdown for all assistant messages
  var mdEls = document.querySelectorAll("[data-md-raw]");
  for (var i = 0; i < mdEls.length; i++) {
    var raw = mdEls[i].getAttribute("data-md-raw");
    if (raw) mdEls[i].innerHTML = renderMarkdown(raw);
  }
})();`;
}

export const SessionDetailPage: FC<SessionDetailProps> = ({
	session,
	messages,
}) => {
	return (
		<Layout
			title={`Session ${session.id.slice(0, 12)}...`}
			currentPath="/sessions"
		>
			<div class="flex items-center gap-md mb-md">
				<a href="/sessions" class="link">
					&larr; Back
				</a>
				<h2 class="mb-0" style="font-size: 18px; font-weight: 600">
					Session Detail
				</h2>
			</div>

			<div class="grid mb-md">
				<div class="card">
					<h3>Info</h3>
					<table>
						<tbody>
							<tr>
								<td>ID</td>
								<td class="text-sm" style="word-break: break-all">
									{session.id}
								</td>
							</tr>
							<tr>
								<td>Channel</td>
								<td>
									<span class="badge neutral">{session.channel}</span>
								</td>
							</tr>
							<tr>
								<td>User</td>
								<td>{session.user_id}</td>
							</tr>
							<tr>
								<td>Created</td>
								<td>{session.created_at}</td>
							</tr>
							<tr>
								<td>Last Activity</td>
								<td>{session.updated_at}</td>
							</tr>
						</tbody>
					</table>
				</div>
			</div>

			<div class="card">
				<h3>Messages ({messages.length})</h3>
				<div
					class="flex-col gap-sm"
					id="session-messages"
					style="padding: 8px 0"
				>
					{messages.map((msg) => {
						const isUser = msg.role === "user";
						const extracted = isUser ? extractUserContent(msg.content) : null;
						const displayText = extracted ? extracted.text : msg.content;
						const isLong = isUser && displayText.length > MSG_TRUNCATE_LEN;

						return (
							<div
								key={msg.id}
								class={`msg-wrapper${isUser ? " user-msg" : ""}`}
							>
								<div class={`avatar ${isUser ? "user-avatar" : "bot-avatar"}`}>
									{isUser ? "U" : "P"}
								</div>
								<div class={`msg ${msg.role}`} style="max-width: 720px">
									<div class="role">
										{msg.role} &middot; {msg.created_at}
										{extracted?.label && (
											<span
												class="badge info"
												style="margin-left:8px;font-size:11px"
											>
												{extracted.label}
											</span>
										)}
									</div>
									{!isUser ? (
										<div class="md-content" data-md-raw={msg.content} />
									) : isLong ? (
										<div data-truncated="1">
											<div
												class="msg-short"
												style="white-space:pre-wrap;word-break:break-word"
											>
												{displayText.slice(0, MSG_TRUNCATE_LEN)}...
											</div>
											<div
												class="msg-full"
												style="display:none;white-space:pre-wrap;word-break:break-word"
											>
												{displayText}
											</div>
											{raw(
												'<button class="msg-toggle btn-ghost btn-sm" style="margin-top:6px;font-size:12px">Show more</button>',
											)}
										</div>
									) : (
										<div style="white-space:pre-wrap;word-break:break-word">
											{displayText}
										</div>
									)}
								</div>
							</div>
						);
					})}
					{messages.length === 0 && (
						<div class="empty-state">
							<p>No messages in this session.</p>
						</div>
					)}
				</div>
			</div>
			{raw(`<script>${sessionDetailScript()}</script>`)}
		</Layout>
	);
};
