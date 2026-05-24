import type { FC } from "hono/jsx";
import { raw } from "hono/html";
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

export const SearchPage: FC<SearchPageProps> = ({ query, hits, error }) => {
	return (
		<Layout title="Search Conversations" currentPath="/search">
			{error && <div class="alert alert-error">{error}</div>}

			<div class="card mb-md">
				<h3>Search</h3>
				<form
					method="get"
					action="/search"
					class="flex gap-sm items-end flex-wrap"
				>
					<div class="flex-1" style="min-width: 240px">
						<input
							type="search"
							name="q"
							value={query}
							placeholder="Search your conversation history..."
							class="w-full"
							autofocus
						/>
					</div>
					<button type="submit" class="btn-primary">
						Search
					</button>
				</form>
				<p class="text-xs text-muted mt-sm">
					Matches across all your sessions. Uses full-text search when
					available; falls back to substring match otherwise.
				</p>
			</div>

			<div class="card">
				<h3>
					{query ? `Results for "${query}" (${hits.length})` : "Enter a query above"}
				</h3>
				{hits.length > 0 ? (
					<div class="flex-col gap-sm">
						{hits.map((hit) => {
							const title = hit.session_title || "Untitled conversation";
							const sessionHref = `/chat?session=${encodeURIComponent(hit.session_id)}`;
							return (
								<a class="search-hit" href={sessionHref}>
									<div class="flex justify-between items-center mb-md">
										<div class="flex gap-sm items-center">
											<span class={`badge ${hit.role === "user" ? "info" : "success"}`}>
												{hit.role}
											</span>
											<span class="text-sm">{title}</span>
											<span class="text-xs text-muted">
												{hit.session_channel}
											</span>
										</div>
										<span class="text-xs text-muted">{hit.created_at}</span>
									</div>
									<div class="search-snippet">
										{raw(renderSnippet(hit.snippet))}
									</div>
								</a>
							);
						})}
					</div>
				) : query ? (
					<div class="empty-state">
						<p>No messages matched your query.</p>
					</div>
				) : null}
			</div>
		</Layout>
	);
};
