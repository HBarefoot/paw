// llms.txt / llms-full.txt generation.
//
// `llms.txt` is a small CURATED INDEX of the project's meaningful docs (one line
// each); `llms-full.txt` is those docs CONCATENATED for one-shot ingestion by a
// coding agent. Both are generated from the live repo so they never drift — the
// web routes build them on demand (cached), and scripts/gen-llms-txt.ts can also
// write static copies at build/deploy time.
//
// Pure builders (buildLlmsIndex / buildLlmsFull) take already-collected entries
// so they're deterministic and unit-testable; collectDocEntries does the file IO.

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

export interface DocEntry {
	/** Repo-relative path, e.g. "CLAUDE.md" or "docs/EXTENDING-PAW-SKILLS.md". */
	path: string;
	/** Display title for the index. */
	title: string;
	/** One-line description for the index. */
	description: string;
	/** Full file contents (for llms-full.txt). */
	content: string;
}

const PROJECT_TAGLINE =
	"Paw — a personal AI assistant framework built with Bun: multi-provider " +
	"(Claude/OpenAI/Ollama/Gemini), plugins, MCP servers, vector memory, cron, " +
	"a credential vault, and a white-label web console with a live canvas.";

// Curated root docs, in index order, with hand-written one-liners. Files that
// don't exist (e.g. CONSTRUCT.md is the fork's) are skipped silently.
const CURATED: Array<{ path: string; title: string; description: string }> = [
	{
		path: "README.md",
		title: "README",
		description: "Project overview, setup, and quick start.",
	},
	{
		path: "CLAUDE.md",
		title: "CLAUDE.md",
		description:
			"Guidance for coding agents: architecture, commands, testing/release policy, subsystem map.",
	},
	{
		path: "CHANGELOG.md",
		title: "Changelog",
		description: "Release history (Keep a Changelog format, newest first).",
	},
	{
		path: "REVIEW-2026-06-09.md",
		title: "Security Review (2026-06-09)",
		description:
			"Active security review + phased Phase 0–5 action plan (source of truth for security work).",
	},
	{
		path: "AUDIT-REPORT.md",
		title: "Audit Report (Feb 2026)",
		description: "Earlier security/quality audit findings.",
	},
	{
		path: "OPTIMIZATION-REPORT.md",
		title: "Optimization Report (Feb 2026)",
		description: "Performance/cost optimization findings.",
	},
	{
		path: "CONSTRUCT.md",
		title: "CONSTRUCT.md",
		description: "ConstructAI fork guidance (present only in the fork).",
	},
];

// Directories under docs/ whose .md files are auto-included (sorted). Ephemeral
// session hand-off prompts under docs/prompts/ are deliberately excluded.
const DOCS_DIR = "docs";
const EXCLUDE_DIR_SEGMENTS = new Set(["prompts"]);

/** First meaningful paragraph of a markdown doc → a one-line description. */
export function deriveDescription(content: string): string {
	const lines = content.split("\n");
	for (const raw of lines) {
		const line = raw.trim();
		if (!line) continue;
		if (line.startsWith("#")) continue; // skip headings
		if (line.startsWith(">")) continue; // skip blockquotes/callouts
		if (line.startsWith("<!--")) continue; // skip HTML comments
		const text = line.replace(/\s+/g, " ").trim();
		if (text.length <= 160) return text;
		return `${text.slice(0, 157)}...`;
	}
	return "(no description)";
}

function titleFromPath(path: string): string {
	const base = path.split("/").pop() ?? path;
	return base.replace(/\.md$/i, "");
}

function listMarkdown(dir: string, root: string): string[] {
	const out: string[] = [];
	let items: string[] = [];
	try {
		items = readdirSync(dir);
	} catch {
		return out;
	}
	for (const name of items.sort()) {
		const full = join(dir, name);
		let isDir = false;
		try {
			isDir = statSync(full).isDirectory();
		} catch {
			continue;
		}
		if (isDir) {
			if (EXCLUDE_DIR_SEGMENTS.has(name)) continue;
			out.push(...listMarkdown(full, root));
		} else if (name.toLowerCase().endsWith(".md")) {
			out.push(relative(root, full));
		}
	}
	return out;
}

/**
 * Read the curated root docs + auto-discovered docs/ markdown (excluding
 * ephemeral prompts) into DocEntry[]. Missing curated files are skipped.
 * Deterministic: curated order first, then docs/ paths sorted.
 */
export function collectDocEntries(root: string): DocEntry[] {
	const entries: DocEntry[] = [];
	const seen = new Set<string>();

	for (const c of CURATED) {
		const full = join(root, c.path);
		if (!existsSync(full)) continue;
		let content = "";
		try {
			content = readFileSync(full, "utf-8");
		} catch {
			continue;
		}
		entries.push({ ...c, content });
		seen.add(c.path);
	}

	for (const path of listMarkdown(join(root, DOCS_DIR), root).sort()) {
		if (seen.has(path)) continue;
		let content = "";
		try {
			content = readFileSync(join(root, path), "utf-8");
		} catch {
			continue;
		}
		entries.push({
			path,
			title: titleFromPath(path),
			description: deriveDescription(content),
			content,
		});
		seen.add(path);
	}

	return entries;
}

/** Build the curated `llms.txt` index. */
export function buildLlmsIndex(entries: DocEntry[]): string {
	const lines: string[] = [];
	lines.push("# Paw");
	lines.push("");
	lines.push(`> ${PROJECT_TAGLINE}`);
	lines.push("");
	lines.push("## Docs");
	for (const e of entries) {
		lines.push(`- [${e.title}](/${e.path}): ${e.description}`);
	}
	lines.push("");
	lines.push("## Full text");
	lines.push(
		"- [llms-full.txt](/llms-full.txt): all of the above docs concatenated for one-shot ingestion.",
	);
	lines.push("");
	return lines.join("\n");
}

/** Build `llms-full.txt`: every doc concatenated with a header + separator. */
export function buildLlmsFull(entries: DocEntry[]): string {
	const parts: string[] = [];
	parts.push("# Paw — full documentation");
	parts.push("");
	parts.push(`> ${PROJECT_TAGLINE}`);
	parts.push("");
	for (const e of entries) {
		parts.push("");
		parts.push(
			"================================================================",
		);
		parts.push(`# ${e.title}`);
		parts.push(`Source: ${e.path}`);
		parts.push(
			"================================================================",
		);
		parts.push("");
		parts.push(e.content.trimEnd());
		parts.push("");
	}
	return parts.join("\n");
}

/** Convenience: collect + build both, from a repo root (default cwd). */
export function generateLlmsDocs(root: string = process.cwd()): {
	index: string;
	full: string;
} {
	const entries = collectDocEntries(root);
	return { index: buildLlmsIndex(entries), full: buildLlmsFull(entries) };
}
