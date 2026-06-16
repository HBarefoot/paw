import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { GitHubApprovals } from "../../src/integrations/github/approvals.js";
import { PlaybookManager } from "../../src/playbooks/manager.js";
import type { DraftPlaybook } from "../../src/playbooks/manager.js";
import { createPlaybookTools } from "../../src/tools/playbook-tools.js";
import type { ToolDefinition } from "../../src/types/message.js";

function call(tool: ToolDefinition, input: Record<string, unknown>) {
	return tool.handler(input);
}

describe("playbook tools (self-authoring + hot availability)", () => {
	let dir: string;
	let db: Database;
	let approvals: GitHubApprovals;
	let manager: PlaybookManager;
	let tools: ToolDefinition[];
	const byName = (n: string) => {
		const t = tools.find((x) => x.name === n);
		if (!t) throw new Error(`no tool ${n}`);
		return t;
	};

	beforeEach(() => {
		dir = mkdtempSync(resolve(tmpdir(), "paw-pb-tools-"));
		db = new Database(":memory:");
		db.run(
			`CREATE TABLE github_pending_actions (
       id TEXT PRIMARY KEY, action TEXT NOT NULL, repo TEXT NOT NULL,
       summary TEXT NOT NULL, params_json TEXT NOT NULL DEFAULT '{}',
       status TEXT NOT NULL DEFAULT 'pending', requested_by TEXT,
       created_at TEXT NOT NULL DEFAULT (datetime('now')),
       decided_at TEXT, decided_by TEXT, result_json TEXT,
       origin_channel TEXT, origin_ref TEXT)`,
		);
		manager = new PlaybookManager({ dir });
		manager.scan();
		approvals = new GitHubApprovals(db, undefined);
		// Mirror the kernel: save-on-approve writes the file + hot-refreshes catalog.
		approvals.registerExecutor("playbook_save", async (row) => {
			const p = row.params as Partial<DraftPlaybook>;
			return manager.upsert({
				name: String(p.name ?? ""),
				description: String(p.description ?? ""),
				body: String(p.body ?? ""),
			});
		});
		tools = createPlaybookTools({ manager, approvals });
	});

	afterEach(() => {
		db.close();
		rmSync(dir, { recursive: true, force: true });
	});

	it("load_playbook returns the body for a known name", async () => {
		await manager.upsert({
			name: "onboarding",
			description: "Use when onboarding a client to set them up.",
			body: "1. Collect details.\n2. Set up workspace.",
		});
		const res = await call(byName("load_playbook"), { name: "onboarding" });
		expect(res.is_error).toBeFalsy();
		const data = JSON.parse(res.content) as { name: string; body: string };
		expect(data.name).toBe("onboarding");
		expect(data.body).toContain("Collect details");
	});

	it("load_playbook errors and lists available names for an unknown name", async () => {
		await manager.upsert({
			name: "onboarding",
			description: "Use when onboarding a client to set them up.",
			body: "1. a\n2. b",
		});
		const res = await call(byName("load_playbook"), { name: "nope" });
		expect(res.is_error).toBe(true);
		expect(res.content).toContain("onboarding"); // lists what IS available
	});

	it("create_playbook QUEUES an approval and does NOT write on call", async () => {
		const res = await call(byName("create_playbook"), {
			name: "lead-intake",
			description: "Use when a new lead arrives to qualify and route them.",
			steps: ["Qualify the lead.", "Route to the right rep."],
		});
		const data = JSON.parse(res.content) as { queued: boolean; id: string };
		expect(data.queued).toBe(true);
		// Nothing persisted, nothing in the live catalog yet.
		expect(existsSync(join(dir, "lead-intake.md"))).toBe(false);
		expect(manager.has("lead-intake")).toBe(false);
		const pending = approvals.actionable(24);
		expect(pending.length).toBe(1);
		expect(pending[0].action).toBe("playbook_save");
	});

	it("HEADLINE: approving create_playbook writes the file AND makes it loadable in the same session", async () => {
		const res = await call(byName("create_playbook"), {
			name: "lead-intake",
			description: "Use when a new lead arrives to qualify and route them.",
			steps: ["Qualify the lead.", "Route to the right rep."],
		});
		const { id } = JSON.parse(res.content) as { id: string };

		await approvals.approve(id, "web:1");

		// Persisted to disk...
		expect(existsSync(join(dir, "lead-intake.md"))).toBe(true);
		// ...AND present in the LIVE catalog with no re-scan/reboot...
		expect(manager.has("lead-intake")).toBe(true);
		expect(manager.getCatalogPrompt()).toContain("lead-intake");
		// ...AND immediately loadable via load_playbook in this same session.
		const loaded = await call(byName("load_playbook"), { name: "lead-intake" });
		expect(loaded.is_error).toBeFalsy();
		expect(loaded.content).toContain("Qualify the lead");
	});

	it("a REJECTED create_playbook persists nothing", async () => {
		const res = await call(byName("create_playbook"), {
			name: "lead-intake",
			description: "Use when a new lead arrives to qualify and route them.",
			steps: ["Qualify the lead.", "Route to the right rep."],
		});
		const { id } = JSON.parse(res.content) as { id: string };

		approvals.reject(id, "web:1");

		expect(existsSync(join(dir, "lead-intake.md"))).toBe(false);
		expect(manager.has("lead-intake")).toBe(false);
	});

	it("create_playbook enforces the quality bar before queuing", async () => {
		// Description that doesn't state WHEN to use it → rejected, nothing queued.
		const res = await call(byName("create_playbook"), {
			name: "thing",
			description: "A thing.",
			steps: ["a", "b"],
		});
		expect(res.is_error).toBe(true);
		expect(approvals.actionable(24).length).toBe(0);
	});

	it("update_playbook refuses a name that does not exist", async () => {
		const res = await call(byName("update_playbook"), {
			name: "ghost",
			description: "Use when you need to update a ghost.",
			steps: ["a", "b"],
		});
		expect(res.is_error).toBe(true);
	});

	it("update_playbook on an existing playbook is gated and applies on approve", async () => {
		await manager.upsert({
			name: "onboarding",
			description: "Use when onboarding a client to set them up.",
			body: "1. a\n2. b",
		});
		const res = await call(byName("update_playbook"), {
			name: "onboarding",
			description: "Use when onboarding a NEW client to fully set them up.",
			steps: ["Collect details.", "Create folder.", "Send welcome."],
		});
		const { id } = JSON.parse(res.content) as { id: string };
		await approvals.approve(id, "web:1");
		expect(manager.get("onboarding")?.description).toContain(
			"fully set them up",
		);
		expect(manager.get("onboarding")?.body).toContain("Send welcome");
	});

	it("create/update report unavailable when there is no approval queue", async () => {
		const noQueue = createPlaybookTools({ manager });
		const t = noQueue.find((x) => x.name === "create_playbook");
		if (!t) throw new Error("create_playbook missing");
		const res = await call(t, {
			name: "x-y",
			description: "Use when you need an x-y.",
			steps: ["a", "b"],
		});
		expect(res.is_error).toBe(true);
	});
});
