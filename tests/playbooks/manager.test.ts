import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	PlaybookManager,
	parseFrontmatter,
} from "../../src/playbooks/manager.js";

let dir: string;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "paw-playbooks-"));
});
afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
});

function write(rel: string, content: string): void {
	const full = join(dir, rel);
	mkdirSync(join(full, ".."), { recursive: true });
	writeFileSync(full, content);
}

const ONBOARDING = `---
name: onboarding
description: Use when onboarding a new client — collect details and set up.
---

1. Collect the client's name and goal.
2. Create their workspace folder.
`;

describe("parseFrontmatter", () => {
	test("parses name + description and returns the body", () => {
		const parsed = parseFrontmatter(ONBOARDING);
		expect(parsed).not.toBeNull();
		expect(parsed?.data.name).toBe("onboarding");
		expect(parsed?.data.description).toContain("onboarding a new client");
		expect(parsed?.body).toContain("1. Collect the client's name");
	});

	test("returns null when there is no frontmatter block", () => {
		expect(
			parseFrontmatter("# Just a heading\n\nNo frontmatter here."),
		).toBeNull();
	});
});

describe("PlaybookManager discovery", () => {
	test("lists a flat <name>.md with the right name + description", () => {
		write("onboarding.md", ONBOARDING);
		const mgr = new PlaybookManager({ dir });
		mgr.scan();
		const entry = mgr.get("onboarding");
		expect(entry).toBeDefined();
		expect(entry?.description).toContain("onboarding a new client");
		expect(entry?.source).toBe("file");
	});

	test("discovers an Anthropic-format <name>/SKILL.md folder too", () => {
		write(
			"foo/SKILL.md",
			"---\nname: foo\ndescription: Use this when you need a foo.\n---\n\n1. Do a.\n2. Do b.\n",
		);
		const mgr = new PlaybookManager({ dir });
		mgr.scan();
		const entry = mgr.get("foo");
		expect(entry).toBeDefined();
		expect(entry?.source).toBe("folder");
	});

	test("skips a frontmatter-less file without crashing", () => {
		write("onboarding.md", ONBOARDING);
		write("broken.md", "# No frontmatter\n\njust text\n");
		const mgr = new PlaybookManager({ dir });
		expect(() => mgr.scan()).not.toThrow();
		expect(mgr.has("onboarding")).toBe(true);
		expect(mgr.names).not.toContain("broken");
	});

	test("a missing dir scans to an empty catalog (no crash)", () => {
		const mgr = new PlaybookManager({ dir: join(dir, "does-not-exist") });
		expect(() => mgr.scan()).not.toThrow();
		expect(mgr.list()).toHaveLength(0);
	});
});

describe("PlaybookManager progressive disclosure", () => {
	test("catalog prompt contains name + description but NOT the body", () => {
		write("onboarding.md", ONBOARDING);
		const mgr = new PlaybookManager({ dir });
		mgr.scan();
		const catalog = mgr.getCatalogPrompt();
		expect(catalog).toContain("onboarding");
		expect(catalog).toContain("onboarding a new client");
		// The body steps must NOT leak into the always-on catalog.
		expect(catalog).not.toContain("Create their workspace folder");
		expect(catalog).not.toContain("Collect the client's name");
	});

	test("empty catalog returns an empty string", () => {
		const mgr = new PlaybookManager({ dir });
		mgr.scan();
		expect(mgr.getCatalogPrompt()).toBe("");
	});
});

describe("PlaybookManager.validateDraft (quality bar)", () => {
	const mgr = () => new PlaybookManager({ dir });

	test("accepts a well-formed draft", () => {
		const v = mgr().validateDraft(
			{
				name: "lead-intake",
				description: "Use when a new lead arrives to qualify and route them.",
				body: "1. Qualify the lead.\n2. Route to the right rep.",
			},
			"create",
		);
		expect(v.ok).toBe(true);
	});

	test("rejects a non-slug name", () => {
		const v = mgr().validateDraft(
			{
				name: "Lead Intake!",
				description: "Use when X to do Y.",
				body: "1. a\n2. b",
			},
			"create",
		);
		expect(v.ok).toBe(false);
	});

	test("rejects a description that doesn't say WHEN to use it", () => {
		const v = mgr().validateDraft(
			{ name: "thing", description: "A thing.", body: "1. a\n2. b" },
			"create",
		);
		expect(v.ok).toBe(false);
	});

	test("rejects fewer than 2 steps", () => {
		const v = mgr().validateDraft(
			{
				name: "thing",
				description: "Use when you need a thing.",
				body: "just do it",
			},
			"create",
		);
		expect(v.ok).toBe(false);
	});

	test("create rejects a name collision; update requires existence", () => {
		write("onboarding.md", ONBOARDING);
		const m = mgr();
		m.scan();
		const collide = m.validateDraft(
			{
				name: "onboarding",
				description: "Use when something totally different happens here.",
				body: "1. a\n2. b",
			},
			"create",
		);
		expect(collide.ok).toBe(false);
		const missing = m.validateDraft(
			{
				name: "nope",
				description: "Use when you need nope.",
				body: "1. a\n2. b",
			},
			"update",
		);
		expect(missing.ok).toBe(false);
	});

	test("rejects a near-duplicate description of an existing playbook", () => {
		write("onboarding.md", ONBOARDING);
		const m = mgr();
		m.scan();
		const v = m.validateDraft(
			{
				name: "onboarding-2",
				description:
					"Use when onboarding a new client — collect details and set up.",
				body: "1. a\n2. b",
			},
			"create",
		);
		expect(v.ok).toBe(false);
	});
});

describe("PlaybookManager.upsert (hot, no re-scan)", () => {
	test("writes the file AND adds it to the live catalog immediately", async () => {
		const mgr = new PlaybookManager({ dir });
		mgr.scan();
		expect(mgr.has("lead-intake")).toBe(false);

		await mgr.upsert({
			name: "lead-intake",
			description: "Use when a new lead arrives to qualify and route them.",
			body: "1. Qualify.\n2. Route.",
		});

		// Present WITHOUT a re-scan — this is the headline hot-availability behavior.
		expect(mgr.has("lead-intake")).toBe(true);
		expect(mgr.get("lead-intake")?.body).toContain("Qualify");

		// And it survives a fresh scan from disk (it was actually persisted).
		const reloaded = new PlaybookManager({ dir });
		reloaded.scan();
		expect(reloaded.has("lead-intake")).toBe(true);
	});
});
