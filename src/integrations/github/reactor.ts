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
	/** When CI fails on a PR, run an agent turn to diagnose + comment. */
	autoInvestigateCi?: boolean;
	logger?: { warn: (msg: string, meta?: Record<string, unknown>) => void };
}

const INVESTIGATE_MAX_PER_PR = 3;
const INVESTIGATE_WINDOW_MS = 60 * 60 * 1000; // 1 hour

/**
 * GitHubReactor — turns inbound `github:event`s (from the verified webhook) into
 * durable notifications so the agent visibly "has something for you", and (when
 * enabled) auto-investigates CI failures by running an agent turn that reads the
 * logs and posts a diagnosis comment (never commits/merges).
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

	// Loop guards: never investigate the same run twice; cap attempts per PR.
	const investigatedRuns = new Set<string>();
	const prAttempts = new Map<string, { count: number; windowStart: number }>();
	function canInvestigatePr(repo: string, pr: number): boolean {
		const key = `${repo}#${pr}`;
		const now = Date.now();
		const cur = prAttempts.get(key);
		if (!cur || now - cur.windowStart > INVESTIGATE_WINDOW_MS) {
			prAttempts.set(key, { count: 1, windowStart: now });
			return true;
		}
		if (cur.count >= INVESTIGATE_MAX_PER_PR) return false;
		cur.count += 1;
		return true;
	}

	return deps.bus.on("github:event", async (evt) => {
		try {
			if (await isSelf(evt.sender)) return;
			const n = notificationForEvent(evt);
			if (n) deps.notifications.add(n);
			if (deps.autoInvestigateCi) await maybeInvestigateCi(deps, evt);
		} catch (err) {
			deps.logger?.warn("GitHub reactor error", { error: String(err) });
		}
	});

	/** Kick off an agent turn to diagnose a CI failure (guarded). */
	async function maybeInvestigateCi(
		d: GitHubReactorDeps,
		evt: GitHubEvent,
	): Promise<void> {
		if (
			evt.eventType !== "check_run" &&
			evt.eventType !== "check_suite" &&
			evt.eventType !== "workflow_run"
		)
			return;
		// biome-ignore lint/suspicious/noExplicitAny: untyped webhook payload
		const obj = (evt.payload as any)[evt.eventType] ?? {};
		const concl = String(obj.conclusion ?? "");
		if (concl !== "failure" && concl !== "timed_out") return;
		const repo = evt.repo ?? "";
		if (!repo || !d.client.isRepoAllowed(repo)) return;
		const runId = obj.id ? String(obj.id) : "";
		const runKey = `${repo}#run:${runId}`;
		if (runId && investigatedRuns.has(runKey)) return; // already handled

		const pr = obj.pull_requests?.[0]?.number as number | undefined;
		if (!pr) return; // need a PR to comment on
		if (!canInvestigatePr(repo, pr)) return; // cooldown / max attempts
		if (runId) investigatedRuns.add(runKey);

		const name = obj.name ?? obj.display_title ?? evt.eventType;
		const runUrl = obj.html_url ?? evt.url;
		const prompt = `A GitHub Actions CI run just failed.

Repository: ${repo}
Pull request: #${pr}
Failed check/workflow: ${name}${runUrl ? `\nRun: ${runUrl}` : ""}

Investigate and help. Steps:
1. Call activate_skill with skill "github" to load the GitHub tools.
2. Use github_get_workflow_runs and github_get_run_logs to read WHY it failed (the failing job's failing step + log excerpt).
3. Post a concise diagnosis and a concrete suggested fix as a comment on PR #${pr} with github_comment.

Comment only — do NOT commit, push, merge, or force-push.`;

		await d.bus.emit("message:inbound", {
			id: crypto.randomUUID(),
			sessionId: `github-${repo.replace(/[^a-z0-9]/gi, "-")}-${runId || pr}`,
			channel: "github",
			content: prompt,
			user: { id: "system", name: "GitHub" },
			timestamp: new Date().toISOString(),
		});
		d.notifications.add({
			kind: "github",
			level: "info",
			title: `Investigating CI failure on PR #${pr} (${repo})`,
			url: runUrl,
		});
	}
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
