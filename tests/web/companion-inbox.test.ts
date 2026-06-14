import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

// feat/companion-inbox-approvals — clicking a skill pill opens an inbox of that
// skill's notifications (mark read per-item + all) plus pending approvals routed
// to that skill, each with Approve / Decline. Logic lives in pure helpers + a
// thin DOM controller in companion/inbox.js. These tests fail on the pre-feature
// code (inbox.js absent → the readFileSync below throws; the shell/app wiring
// assertions also fail).

const ROOT = new URL("../../src/web/public/companion/", import.meta.url);
const INBOX_SRC = readFileSync(new URL("inbox.js", ROOT), "utf8");
const SHELL_SRC = readFileSync(new URL("shell.js", ROOT), "utf8");
const APP_SRC = readFileSync(
	new URL("../../src/web/app.ts", import.meta.url),
	"utf8",
);

/** Load inbox.js into a fresh fake window and return window.CompanionInbox. */
// biome-ignore lint/suspicious/noExplicitAny: test harness is intentionally untyped
function loadInbox(): any {
	// biome-ignore lint/suspicious/noExplicitAny: stub window
	const win: any = {};
	new Function("window", INBOX_SRC)(win);
	return win.CompanionInbox;
}

// ── a minimal but functional fake DOM (no jsdom in this repo) ──
class FakeEl {
	tag: string;
	className = "";
	attrs: Record<string, string> = {};
	children: FakeEl[] = [];
	parent: FakeEl | null = null;
	listeners: Record<string, Array<(e: unknown) => void>> = {};
	style = { setProperty() {} };
	classes = new Set<string>();
	#tc = "";
	constructor(tag: string) {
		this.tag = tag;
	}
	get classList() {
		const s = this.classes;
		return {
			add: (c: string) => s.add(c),
			remove: (c: string) => s.delete(c),
			contains: (c: string) => s.has(c),
			toggle: (c: string, on?: boolean) => {
				const want = on === undefined ? !s.has(c) : on;
				if (want) s.add(c);
				else s.delete(c);
				return want;
			},
		};
	}
	set textContent(v: string) {
		this.#tc = v;
		if (v === "") this.children = [];
	}
	get textContent() {
		return this.#tc;
	}
	setAttribute(k: string, v: string) {
		this.attrs[k] = String(v);
	}
	getAttribute(k: string) {
		return k in this.attrs ? this.attrs[k] : null;
	}
	removeAttribute(k: string) {
		delete this.attrs[k];
	}
	hasAttribute(k: string) {
		return k in this.attrs;
	}
	addEventListener(t: string, fn: (e: unknown) => void) {
		if (!this.listeners[t]) this.listeners[t] = [];
		this.listeners[t].push(fn);
	}
	removeEventListener(t: string, fn: (e: unknown) => void) {
		const a = this.listeners[t];
		if (a) {
			const i = a.indexOf(fn);
			if (i >= 0) a.splice(i, 1);
		}
	}
	appendChild(c: FakeEl) {
		c.parent = this;
		this.children.push(c);
		return c;
	}
	removeChild(c: FakeEl) {
		const i = this.children.indexOf(c);
		if (i >= 0) this.children.splice(i, 1);
		return c;
	}
}
const fakeDoc = { createElement: (t: string) => new FakeEl(t) };

const tick = () => new Promise((r) => setTimeout(r, 0));

type Route = { status?: number; ok?: boolean; body?: unknown };
/** A programmable fetch that records calls and routes by url + method. */
function makeFetch(handler: (url: string, opts: { method?: string }) => Route) {
	const calls: Array<{ url: string; method: string; body: unknown }> = [];
	const fn = async (url: string, opts?: { method?: string; body?: string }) => {
		const method = (opts?.method || "GET").toUpperCase();
		let body: unknown = null;
		try {
			body = opts?.body ? JSON.parse(opts.body) : null;
		} catch {
			body = null;
		}
		calls.push({ url, method, body });
		const r = handler(url, { method });
		const status = r.status ?? 200;
		return {
			ok: r.ok ?? status < 400,
			status,
			json: async () => r.body ?? {},
		};
	};
	return Object.assign(fn, { calls });
}

const SKILLS = [
	{ key: "github", label: "GitHub" },
	{ key: "slack", label: "Slack" },
];

/** Build a controller wired to a fake engine + fake DOM + programmable fetch. */
function setup(opts: {
	// biome-ignore lint/suspicious/noExplicitAny: harness
	CI: any;
	notifications?: unknown[];
	pending?: unknown[];
	unreadByKind?: Record<string, number>;
	skills?: Array<{ key: string; label: string }>;
	route?: (url: string, o: { method?: string }) => Route;
}) {
	const state = {
		unread: { ...(opts.unreadByKind ?? {}) } as Record<string, number>,
		pending: { n: 0, label: "" },
	};
	const route =
		opts.route ??
		((url: string) => {
			if (url === "/api/notifications")
				return {
					body: {
						notifications: opts.notifications ?? [],
						unreadByKind: opts.unreadByKind ?? {},
					},
				};
			if (url === "/api/approvals/pending")
				return { body: { pending: opts.pending ?? [] } };
			return { body: { ok: true } }; // POST read/approve/deny
		});
	const fetchSpy = makeFetch(route);
	const host = new FakeEl("div");
	const inbox = opts.CI.create({
		doc: fakeDoc,
		host,
		fetch: fetchSpy,
		getSkills: () => opts.skills ?? SKILLS,
		getUnreadByKind: () => state.unread,
		setUnreadByKind: (m: Record<string, number>) => {
			state.unread = m;
		},
		setPending: (n: number, label: string) => {
			state.pending = { n, label };
		},
		now: () => 1_700_000_000_000,
	});
	return { inbox, fetchSpy, state, host };
}

const notif = (
	id: string,
	kind: string,
	extra: Record<string, unknown> = {},
) => ({
	id,
	kind,
	title: `${kind} ${id}`,
	body: "",
	level: "info",
	read: 0,
	created_at: "2026-06-14T00:00:00.000Z",
	...extra,
});

// ════════════════════════════════════════════════════════════════════════════
// Pure helpers
// ════════════════════════════════════════════════════════════════════════════
describe("CompanionInbox pure helpers", () => {
	test("filterNotifications keeps only the skill's kind, newest first", () => {
		const CI = loadInbox();
		const items = [
			notif("a", "github", { created_at: "2026-06-14T00:00:01.000Z" }),
			notif("b", "slack"),
			notif("c", "github", { created_at: "2026-06-14T00:00:09.000Z" }),
		];
		const got = CI.filterNotifications(items, "github");
		expect(got.map((n: { id: string }) => n.id)).toEqual(["c", "a"]);
	});

	test("approvalSkillKey routes GitHub actions to github; explicit hint wins; else fallback", () => {
		const CI = loadInbox();
		const keys = new Set(["github", "slack"]);
		expect(CI.approvalSkillKey({ action: "merge_pr" }, keys)).toBe("github");
		expect(CI.approvalSkillKey({ skillKey: "slack" }, keys)).toBe("slack");
		// no github pill → unresolvable → null (→ fallback bucket)
		expect(
			CI.approvalSkillKey({ action: "merge_pr" }, new Set(["slack"])),
		).toBe(null);
		expect(CI.approvalBucket({ action: "merge_pr" }, new Set(["slack"]))).toBe(
			CI.FALLBACK_KEY,
		);
	});

	test("count edits are clamped + replace-only (never negative)", () => {
		const CI = loadInbox();
		expect(CI.decrementKind({ github: 2 }, "github", 1)).toEqual({ github: 1 });
		expect(CI.decrementKind({ github: 1 }, "github", 5)).toEqual({ github: 0 });
		expect(CI.clearKind({ github: 9, slack: 1 }, "github")).toEqual({
			github: 0,
			slack: 1,
		});
	});

	test("isResolvedStatus treats 404/409/410 as resolved-elsewhere", () => {
		const CI = loadInbox();
		expect(CI.isResolvedStatus(404)).toBe(true);
		expect(CI.isResolvedStatus(409)).toBe(true);
		expect(CI.isResolvedStatus(400)).toBe(false);
		expect(CI.isResolvedStatus(200)).toBe(false);
	});
});

// ════════════════════════════════════════════════════════════════════════════
// Feature 1 — skill inbox + mark read
// ════════════════════════════════════════════════════════════════════════════
describe("skill inbox + mark read", () => {
	test("opening a pill filters to that skill's kind; switching re-filters", async () => {
		const CI = loadInbox();
		const { inbox } = setup({
			CI,
			notifications: [
				notif("g1", "github"),
				notif("s1", "slack"),
				notif("g2", "github"),
			],
		});
		inbox.open("github");
		await tick();
		expect(inbox.openKey()).toBe("github");
		expect(
			inbox
				.model()
				.notifications.map((n: { id: string }) => n.id)
				.sort(),
		).toEqual(["g1", "g2"]);
		inbox.open("slack");
		await tick();
		expect(
			inbox.model().notifications.map((n: { id: string }) => n.id),
		).toEqual(["s1"]);
	});

	test("mark-read posts the id and decrements the pill badge map", async () => {
		const CI = loadInbox();
		const { inbox, fetchSpy, state } = setup({
			CI,
			notifications: [notif("g1", "github")],
			unreadByKind: { github: 1 },
		});
		inbox.open("github");
		await tick();
		await inbox.markRead("g1");
		const read = fetchSpy.calls.find(
			(c) => c.url === "/api/notifications/read" && c.method === "POST",
		);
		expect(read?.body).toEqual({ id: "g1" });
		expect(state.unread.github).toBe(0); // decremented, not negative
		expect(inbox.model().notifications[0].read).toBe(1);
	});

	test("mark-all clears the skill's unread; counts never go negative", async () => {
		const CI = loadInbox();
		const { inbox, fetchSpy, state } = setup({
			CI,
			notifications: [
				notif("g1", "github"),
				notif("g2", "github"),
				notif("s1", "slack"),
			],
			unreadByKind: { github: 2, slack: 1 },
		});
		inbox.open("github");
		await tick();
		await inbox.markAllRead("github");
		const posts = fetchSpy.calls.filter(
			(c) => c.url === "/api/notifications/read" && c.method === "POST",
		);
		expect(posts.map((p) => (p.body as { id: string }).id).sort()).toEqual([
			"g1",
			"g2",
		]);
		expect(state.unread.github).toBe(0);
		expect(state.unread.slack).toBe(1); // untouched
	});

	test("a paw:ambient/refresh REPLACES the badge map (no clobber, no double-count)", async () => {
		const CI = loadInbox();
		let serverUnread: Record<string, number> = { github: 2 };
		const { inbox, state } = setup({
			CI,
			route: (url) => {
				if (url === "/api/notifications")
					return {
						body: {
							notifications: [notif("g1", "github")],
							unreadByKind: serverUnread,
						},
					};
				if (url === "/api/approvals/pending") return { body: { pending: [] } };
				return { body: { ok: true } };
			},
		});
		inbox.open("github"); // → refresh → engine map becomes the server's {github:2}
		await tick();
		expect(state.unread.github).toBe(2);
		await inbox.markRead("g1"); // optimistic decrement → 1
		expect(state.unread.github).toBe(1);
		// The server has now processed the read; its authoritative map says 1. A
		// delta-based design would double-decrement to 0 — replace-semantics holds
		// it at the truth, and the open panel is not clobbered.
		serverUnread = { github: 1 };
		await inbox.refresh();
		expect(state.unread.github).toBe(1);
		expect(inbox.openKey()).toBe("github");
	});
});

// ════════════════════════════════════════════════════════════════════════════
// Feature 2 — approve / decline
// ════════════════════════════════════════════════════════════════════════════
const approval = (id: string, action = "merge_pr") => ({
	id,
	action,
	repo: "acme/site",
	summary: `${action} #${id}`,
	status: "pending",
});

describe("approve / decline from the inbox", () => {
	test("pending approvals render in the mapped skill inbox", async () => {
		const CI = loadInbox();
		const { inbox } = setup({ CI, pending: [approval("a1"), approval("a2")] });
		inbox.open("github");
		await tick();
		expect(
			inbox
				.model()
				.approvals.map((a: { id: string }) => a.id)
				.sort(),
		).toEqual(["a1", "a2"]);
	});

	test("unmapped approvals surface in the fallback inbox, not dropped", async () => {
		const CI = loadInbox();
		// no github pill → merge_pr can't map → fallback
		const { inbox, host } = setup({
			CI,
			skills: [{ key: "slack", label: "Slack" }],
			pending: [approval("a1")],
		});
		inbox.open("slack");
		await tick();
		expect(inbox.model().approvals).toEqual([]); // not on slack
		inbox.open(CI.FALLBACK_KEY);
		await tick();
		expect(inbox.model().approvals.map((a: { id: string }) => a.id)).toEqual([
			"a1",
		]);
		// the fallback chip became visible (an affordance exists)
		const chip = host.children.find((c) =>
			c.className.includes("inbox-fallback-chip"),
		);
		expect(chip?.hasAttribute("hidden")).toBe(false);
	});

	test("approve hits /approve, removes the row, updates the pending count", async () => {
		const CI = loadInbox();
		const { inbox, fetchSpy, state } = setup({
			CI,
			pending: [approval("a1"), approval("a2")],
		});
		inbox.open("github");
		await tick();
		await inbox.approve("a1");
		expect(
			fetchSpy.calls.some(
				(c) => c.url === "/api/approvals/a1/approve" && c.method === "POST",
			),
		).toBe(true);
		expect(inbox.model().approvals.map((a: { id: string }) => a.id)).toEqual([
			"a2",
		]);
		expect(state.pending.n).toBe(1);
	});

	test("decline hits /deny and removes the row", async () => {
		const CI = loadInbox();
		const { inbox, fetchSpy } = setup({ CI, pending: [approval("a1")] });
		inbox.open("github");
		await tick();
		await inbox.decline("a1");
		expect(
			fetchSpy.calls.some(
				(c) => c.url === "/api/approvals/a1/deny" && c.method === "POST",
			),
		).toBe(true);
		expect(inbox.model().approvals).toEqual([]);
	});

	test("an already-resolved approval (404/409) reconciles silently", async () => {
		const CI = loadInbox();
		const { inbox, state } = setup({
			CI,
			pending: [approval("a1"), approval("a2")],
			route: (url) => {
				if (url === "/api/notifications")
					return { body: { notifications: [], unreadByKind: {} } };
				if (url === "/api/approvals/pending")
					return { body: { pending: [approval("a1"), approval("a2")] } };
				if (url.endsWith("/approve"))
					return { ok: false, status: 404, body: { error: "gone" } };
				return { body: { ok: true } };
			},
		});
		inbox.open("github");
		await tick();
		await inbox.approve("a1"); // resolved elsewhere → 404, but row still drops
		expect(inbox.model().approvals.map((a: { id: string }) => a.id)).toEqual([
			"a2",
		]);
		expect(state.pending.n).toBe(1);
	});
});

// ════════════════════════════════════════════════════════════════════════════
// Wiring regression guards (fail on pre-feature code)
// ════════════════════════════════════════════════════════════════════════════
describe("companion wiring", () => {
	test("shell.js wires clickable pills to the inbox controller", () => {
		expect(SHELL_SRC).toContain("window.CompanionInbox");
		expect(SHELL_SRC).toContain('t.closest(".pill")');
		expect(SHELL_SRC).toContain("inbox.open(key)");
		// Esc / outside-click close it
		expect(SHELL_SRC).toContain('ev.key === "Escape"');
	});

	test("/companion serves inbox.js before shell.js", () => {
		const i = APP_SRC.indexOf("/companion/static/inbox.js");
		const s = APP_SRC.indexOf("/companion/static/shell.js");
		expect(i).toBeGreaterThan(-1);
		expect(s).toBeGreaterThan(-1);
		expect(i).toBeLessThan(s);
	});
});
