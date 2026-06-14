import { raw } from "hono/html";
import type { FC } from "hono/jsx";
import { icon } from "./icons.js";
import { Layout } from "./layout.js";

/**
 * Escape raw snippet content, then reinstate the highlight markers as
 * real <mark> tags. Avoids XSS when AI output contains HTML-looking text.
 */
function renderSnippet(snippet: string): string {
	const escaped = snippet
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");
	return escaped
		.replace(/@@HL_OPEN@@/g, "<mark>")
		.replace(/@@HL_CLOSE@@/g, "</mark>");
}

export interface SearchHit {
	id: string;
	session_id: string;
	role: "user" | "assistant" | "tool";
	snippet: string;
	created_at: string;
	session_title: string | null;
	session_channel: string;
}

export interface SearchPageProps {
	query: string;
	hits: SearchHit[];
	error?: string;
}

const roleIcon: Record<string, string> = {
	user: "user",
	assistant: "sparkles",
	tool: "terminal",
};

export const SearchPage: FC<SearchPageProps> = ({ query, hits, error }) => {
	return (
		<Layout title="Search" currentPath="/search">
			{error && <div class="alert alert-error">{error}</div>}

			<div
				class="search-hero"
				style="display:flex;flex-direction:column;gap:16px"
			>
				<form method="get" action="/search">
					<div class="big-box">
						{raw(icon("search", 19))}
						<input
							type="search"
							name="q"
							value={query}
							placeholder="Search sessions and tool messages…"
							autofocus
						/>
						<button type="submit" class="btn-primary btn-sm">
							Search
						</button>
					</div>
				</form>

				<div style="display:flex;align-items:center;justify-content:space-between;gap:10px">
					<span class="pill-badge dim">Conversations</span>
					{query && (
						<span class="dim" style="font-size:11px">
							{hits.length} result{hits.length === 1 ? "" : "s"}
						</span>
					)}
				</div>

				{!query ? (
					<div class="empty-state">
						{raw(icon("search", 30))}
						<div class="t">Search your history</div>
						<div class="s">
							Full-text across all your sessions; falls back to substring match.
						</div>
					</div>
				) : hits.length === 0 ? (
					<div class="empty-state">
						{raw(icon("search", 30))}
						<div class="t">No matches</div>
						<div class="s">Try a different term.</div>
					</div>
				) : (
					<div style="display:flex;flex-direction:column;gap:10px">
						{hits.map((hit) => (
							<a
								key={hit.id}
								class="res"
								href={`/chat?session=${encodeURIComponent(hit.session_id)}`}
							>
								<div class="ricon">
									{raw(icon(roleIcon[hit.role] ?? "chat", 17))}
								</div>
								<div class="rmain">
									<div class="rt">
										{hit.session_title || "Untitled conversation"}
										<span class="pill-badge dim">{hit.role}</span>
										<span class="dim" style="font-size:10.5px">
											{hit.session_channel}
										</span>
									</div>
									<div class="rs">{raw(renderSnippet(hit.snippet))}</div>
								</div>
								<div class="rmeta">{hit.created_at}</div>
							</a>
						))}
					</div>
				)}
			</div>
		</Layout>
	);
};
