import type { EventBus } from "../../kernel/bus.js";
import type {
	NotificationInput,
	NotificationStore,
} from "../../store/notifications.js";
import type { EventMap } from "../../types/events.js";
import type { GitHubClient } from "./client.js";

type GitHubEvent = EventMap["github:event"];

export interface GitHubReactorDeps {
	bus: EventBus;
	notifications: NotificationStore;
	client: GitHubClient;
	logger?: { warn: (msg: string, meta?: Record<string, unknown>) => void };
}

/**
 * GitHubReactor — turns inbound `github:event`s (from the verified webhook) into
 * durable notifications so the agent visibly "has something for you". Phase A is
 * notify-only; Phase B adds auto-investigation of CI failures.
 *
 * Self-caused events (sender == the App's own bot) are skipped to avoid noise/
 * loops. Returns an unsubscribe function.
 */
export function startGitHubReactor(deps: GitHubReactorDeps): () => void {
	let appBotLogin: string | null = null;
	let resolved = false;
	async function isSelf(sender?: string): Promise<boolean> {
		if (!sender) return false;
		if (!resolved) {
			resolved = true;
			try {
				const st = await deps.client.getStatus();
				appBotLogin = st.appSlug ? `${st.appSlug}[bot]`.toLowerCase() : null;
			} catch {
				appBotLogin = null;
			}
		}
		return appBotLogin != null && sender.toLowerCase() === appBotLogin;
	}

	return deps.bus.on("github:event", async (evt) => {
		try {
			if (await isSelf(evt.sender)) return;
			const n = notificationForEvent(evt);
			if (!n) return;
			const id = deps.notifications.add(n);
			await deps.bus.emit("notification:created", {
				id,
				kind: n.kind ?? "github",
				title: n.title,
				level: n.level ?? "info",
			});
		} catch (err) {
			deps.logger?.warn("GitHub reactor error", { error: String(err) });
		}
	});
}

/** Map a curated set of GitHub events to a notification (or null to ignore). */
export function notificationForEvent(
	evt: GitHubEvent,
): NotificationInput | null {
	// biome-ignore lint/suspicious/noExplicitAny: webhook payloads are untyped JSON
	const p = evt.payload as any;
	const repo = evt.repo ?? "";
	switch (evt.eventType) {
		case "pull_request": {
			const pr = p.pull_request ?? {};
			const n = pr.number;
			if (evt.action === "opened" || evt.action === "reopened") {
				return {
					kind: "github",
					level: "info",
					title: `PR #${n} opened in ${repo}`,
					body: pr.title,
					url: pr.html_url,
				};
			}
			if (evt.action === "closed") {
				return pr.merged
					? {
							kind: "github",
							level: "success",
							title: `PR #${n} merged in ${repo}`,
							body: pr.title,
							url: pr.html_url,
						}
					: {
							kind: "github",
							level: "info",
							title: `PR #${n} closed in ${repo}`,
							body: pr.title,
							url: pr.html_url,
						};
			}
			return null;
		}
		case "pull_request_review": {
			const pr = p.pull_request ?? {};
			const review = p.review ?? {};
			const n = pr.number;
			const state = String(review.state ?? "").toUpperCase();
			if (state === "CHANGES_REQUESTED") {
				return {
					kind: "github",
					level: "warning",
					title: `Changes requested on PR #${n} (${repo})`,
					body: review.body,
					url: pr.html_url,
				};
			}
			if (state === "APPROVED") {
				return {
					kind: "github",
					level: "success",
					title: `PR #${n} approved (${repo})`,
					url: pr.html_url,
				};
			}
			return null;
		}
		case "check_run":
		case "check_suite":
		case "workflow_run": {
			const obj = p[evt.eventType] ?? {};
			const concl = String(obj.conclusion ?? "");
			// Notify on failure only — CI success is noise.
			if (concl === "failure" || concl === "timed_out") {
				const name = obj.name ?? obj.display_title ?? evt.eventType;
				return {
					kind: "github",
					level: "error",
					title: `CI failed in ${repo}: ${name}`,
					body: evt.summary,
					url: obj.html_url ?? obj.details_url,
				};
			}
			return null;
		}
		case "issues": {
			const iss = p.issue ?? {};
			const n = iss.number;
			if (evt.action === "opened") {
				return {
					kind: "github",
					level: "info",
					title: `Issue #${n} opened in ${repo}`,
					body: iss.title,
					url: iss.html_url,
				};
			}
			return null;
		}
		default:
			return null;
	}
}
