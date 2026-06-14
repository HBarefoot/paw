import { describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import {
	type DocEntry,
	buildLlmsFull,
	buildLlmsIndex,
	collectDocEntries,
	deriveDescription,
	generateLlmsDocs,
} from "../../src/web/llms-docs.js";

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));

const SAMPLE: DocEntry[] = [
	{
		path: "README.md",
		title: "README",
		description: "Overview.",
		content: "# Readme\n\nhello world",
	},
	{
		path: "docs/EXTENDING-PAW-SKILLS.md",
		title: "EXTENDING-PAW-SKILLS",
		description: "How to add skills.",
		content: "# Skills\n\nbody text",
	},
];

describe("llms.txt pure builders", () => {
	test("buildLlmsIndex lists each doc with its description + a full-text link", () => {
		const out = buildLlmsIndex(SAMPLE);
		expect(out.startsWith("# Paw")).toBe(true);
		expect(out).toContain("## Docs");
		expect(out).toContain("- [README](/README.md): Overview.");
		expect(out).toContain(
			"- [EXTENDING-PAW-SKILLS](/docs/EXTENDING-PAW-SKILLS.md): How to add skills.",
		);
		expect(out).toContain("[llms-full.txt](/llms-full.txt)");
	});

	test("buildLlmsFull concatenates every doc with a source header", () => {
		const out = buildLlmsFull(SAMPLE);
		expect(out).toContain("Source: README.md");
		expect(out).toContain("hello world");
		expect(out).toContain("Source: docs/EXTENDING-PAW-SKILLS.md");
		expect(out).toContain("body text");
		// README appears before the docs/ entry (curated order preserved).
		expect(out.indexOf("Source: README.md")).toBeLessThan(
			out.indexOf("Source: docs/EXTENDING-PAW-SKILLS.md"),
		);
	});

	test("builders are deterministic for fixed input", () => {
		expect(buildLlmsIndex(SAMPLE)).toBe(buildLlmsIndex(SAMPLE));
		expect(buildLlmsFull(SAMPLE)).toBe(buildLlmsFull(SAMPLE));
	});
});

describe("deriveDescription", () => {
	test("uses the first real paragraph, skipping headings/blockquotes/comments", () => {
		expect(
			deriveDescription("# Title\n\n> a callout\n\nThe real first line."),
		).toBe("The real first line.");
		expect(deriveDescription("<!-- c -->\n# H\n")).toBe("(no description)");
	});

	test("truncates very long first lines", () => {
		const long = `# H\n\n${"x".repeat(300)}`;
		const d = deriveDescription(long);
		expect(d.length).toBeLessThanOrEqual(160);
		expect(d.endsWith("...")).toBe(true);
	});
});

describe("collectDocEntries against the real repo", () => {
	const entries = collectDocEntries(REPO_ROOT);
	const paths = entries.map((e) => e.path);

	test("includes the curated root docs that exist", () => {
		expect(paths).toContain("CLAUDE.md");
		expect(paths).toContain("README.md");
		// Curated order: README before CLAUDE before CHANGELOG.
		expect(paths.indexOf("README.md")).toBeLessThan(paths.indexOf("CLAUDE.md"));
	});

	test("auto-includes docs/ markdown but EXCLUDES ephemeral docs/prompts", () => {
		expect(paths).toContain("docs/EXTENDING-PAW-SKILLS.md");
		expect(paths.some((p) => p.startsWith("docs/prompts/"))).toBe(false);
	});

	test("skips curated files that don't exist (CONSTRUCT.md is fork-only)", () => {
		// Paw (not the fork) has no CONSTRUCT.md — it must be skipped, not errored.
		expect(paths).not.toContain("CONSTRUCT.md");
	});

	test("every entry has content + a non-empty description", () => {
		for (const e of entries) {
			expect(e.content.length).toBeGreaterThan(0);
			expect(e.description.length).toBeGreaterThan(0);
		}
	});
});

describe("generateLlmsDocs end-to-end", () => {
	test("produces both outputs and regenerates deterministically", () => {
		const a = generateLlmsDocs(REPO_ROOT);
		const b = generateLlmsDocs(REPO_ROOT);
		expect(a.index).toBe(b.index);
		expect(a.full).toBe(b.full);
		expect(a.index).toContain("[CLAUDE.md](/CLAUDE.md)");
		expect(a.full).toContain("Source: CLAUDE.md");
	});
});
