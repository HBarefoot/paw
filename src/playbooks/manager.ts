import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Logger } from "../types/plugin.js";

/**
 * Playbooks — self-authored, reusable markdown procedures (progressive
 * disclosure), one layer up from `SkillManager`. A playbook is a markdown file
 * (`playbooks/<name>.md` or an Anthropic-format `playbooks/<name>/SKILL.md`)
 * with YAML frontmatter (`name` + `description`) and a body of step
 * instructions. They are GUIDANCE the model follows in its normal loop — there
 * is no executor, run-state, or resume (declined for v1; see
 * docs/prompts/PROMPT-paw-workflow-engine-phase1.md).
 *
 * Mirrors `SkillManager`: `getCatalogPrompt()` surfaces only name+description
 * into the system prompt; the full body is loaded on demand (`load_playbook`).
 * The catalog is an in-memory map that refreshes the instant a playbook is
 * authored + approved (`upsert`), so Paw can author a playbook and use it later
 * in the SAME session — no re-scan or reboot.
 */

export interface PlaybookEntry {
	name: string;
	description: string;
	/** The markdown after the frontmatter — the step instructions. */
	body: string;
	/** Where it was loaded from: a flat `<name>.md` or a `<name>/SKILL.md` folder. */
	source: "file" | "folder";
	/**
	 * Which root it came from: `bundled` (read-only, in-image/repo) or `writable`
	 * (the persistent runtime root). On a name collision the `writable` entry wins.
	 */
	origin: "bundled" | "writable";
}

/** A playbook name: a filesystem-safe slug (lowercase, dash-separated). */
export const PLAYBOOK_NAME_RE = /^[a-z0-9][a-z0-9-]*$/;

export interface DraftPlaybook {
	name: string;
	description: string;
	body: string;
}

export type ValidationResult = { ok: true } | { ok: false; error: string };

/**
 * Parse YAML-ish frontmatter (only the `key: value` subset we need). Returns the
 * frontmatter map + the body after the closing fence, or null if the document
 * has no leading `---` frontmatter block at all.
 */
export function parseFrontmatter(
	raw: string,
): { data: Record<string, string>; body: string } | null {
	// Normalize CRLF so the fence regex is reliable.
	const text = raw.replace(/\r\n/g, "\n");
	if (!text.startsWith("---\n")) return null;
	const end = text.indexOf("\n---", 4);
	if (end === -1) return null;
	const block = text.slice(4, end);
	// Body begins after the closing fence line.
	const afterFence = text.indexOf("\n", end + 1);
	const body = afterFence === -1 ? "" : text.slice(afterFence + 1);

	const data: Record<string, string> = {};
	for (const line of block.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) continue;
		const colon = trimmed.indexOf(":");
		if (colon === -1) continue;
		const key = trimmed.slice(0, colon).trim();
		let value = trimmed.slice(colon + 1).trim();
		// Strip matching surrounding quotes.
		if (
			(value.startsWith('"') && value.endsWith('"')) ||
			(value.startsWith("'") && value.endsWith("'"))
		) {
			value = value.slice(1, -1);
		}
		if (key) data[key] = value;
	}
	return { data, body: body.replace(/\s+$/, "") };
}

/** Serialize a playbook back to a `<name>.md` document with frontmatter. */
export function renderPlaybook(p: DraftPlaybook): string {
	// Escape any stray frontmatter fence in the description so it can't break out.
	const desc = p.description.replace(/\n/g, " ").trim();
	return `---\nname: ${p.name}\ndescription: ${desc}\n---\n\n${p.body.trimEnd()}\n`;
}

/** Count the step-like lines in a body (numbered list, bullets, or ## headings). */
function countSteps(body: string): number {
	let n = 0;
	for (const line of body.split("\n")) {
		const t = line.trim();
		if (
			/^\d+[.)]\s+\S/.test(t) ||
			/^[-*]\s+\S/.test(t) ||
			/^#{1,6}\s+\S/.test(t)
		) {
			n++;
		}
	}
	return n;
}

/** Normalized token set for the cheap near-duplicate description check. */
function tokenize(s: string): Set<string> {
	return new Set(
		s
			.toLowerCase()
			.replace(/[^a-z0-9\s]/g, " ")
			.split(/\s+/)
			.filter((w) => w.length > 2),
	);
}

/** Jaccard similarity between two descriptions (0..1). */
function similarity(a: string, b: string): number {
	const sa = tokenize(a);
	const sb = tokenize(b);
	if (sa.size === 0 || sb.size === 0) return 0;
	let inter = 0;
	for (const t of sa) if (sb.has(t)) inter++;
	return inter / (sa.size + sb.size - inter);
}

const NOOP_LOGGER: Logger = {
	debug() {},
	info() {},
	warn() {},
	error() {},
} as unknown as Logger;

export class PlaybookManager {
	/** Read-only root: the in-image / repo-shipped (bundled) playbooks. */
	private readonly bundledDir: string;
	/** Persistent root: where runtime-authored playbooks are written. */
	private readonly writableDir: string;
	private readonly logger: Logger;
	private playbooks = new Map<string, PlaybookEntry>();

	/**
	 * Two roots, read-merged into one catalog:
	 * - `bundledDir` (read-only): the in-image / repo dir where committed
	 *   playbooks ship (e.g. `onboarding.md`).
	 * - `writableDir` (persistent): a `/data`-resolved dir for runtime-authored
	 *   playbooks; `upsert` always writes here so authored playbooks survive a
	 *   Railway redeploy.
	 *
	 * Pass `dir` instead for the single-root (dev/local) case — both roots
	 * collapse to it, preserving the pre-two-root behavior.
	 */
	constructor(opts: {
		dir?: string;
		bundledDir?: string;
		writableDir?: string;
		logger?: Logger;
	}) {
		const bundled = opts.bundledDir ?? opts.dir;
		const writable = opts.writableDir ?? opts.dir ?? bundled;
		if (!bundled || !writable) {
			throw new Error(
				"PlaybookManager needs a `dir` or both `bundledDir`+`writableDir`.",
			);
		}
		this.bundledDir = resolve(bundled);
		this.writableDir = resolve(writable);
		this.logger = opts.logger ?? NOOP_LOGGER;
	}

	/** The resolved WRITABLE playbooks directory (created on first write). */
	get directory(): string {
		return this.writableDir;
	}

	/** The resolved bundled (read-only) playbooks directory. */
	get bundledDirectory(): string {
		return this.bundledDir;
	}

	/**
	 * (Re)scan BOTH roots into the one in-memory catalog. Supports both
	 * `playbooks/<name>.md` and `playbooks/<name>/SKILL.md`. The bundled root is
	 * read first, then the writable root — so on a name collision the writable
	 * (authored) entry wins. A file missing frontmatter is skipped with a warning,
	 * never fatal; a missing root is a silent no-op.
	 */
	scan(): void {
		this.playbooks.clear();
		this.scanRoot(this.bundledDir, "bundled");
		// Writable second so an authored override beats a bundled playbook of the
		// same name. Skip the redundant pass when both roots are the same dir.
		if (this.writableDir !== this.bundledDir) {
			this.scanRoot(this.writableDir, "writable");
		}
	}

	private scanRoot(dir: string, origin: "bundled" | "writable"): void {
		if (!existsSync(dir)) return;
		let entries: import("node:fs").Dirent[];
		try {
			entries = readdirSync(dir, { withFileTypes: true });
		} catch (err) {
			this.logger.warn("Playbook scan failed", { dir, error: String(err) });
			return;
		}
		for (const ent of entries) {
			try {
				if (ent.isFile() && ent.name.endsWith(".md")) {
					this.loadFromPath(join(dir, ent.name), "file", origin);
				} else if (ent.isDirectory()) {
					const skillPath = join(dir, ent.name, "SKILL.md");
					if (existsSync(skillPath))
						this.loadFromPath(skillPath, "folder", origin);
				}
			} catch (err) {
				this.logger.warn("Skipping unreadable playbook", {
					entry: ent.name,
					error: String(err),
				});
			}
		}
	}

	private loadFromPath(
		path: string,
		source: "file" | "folder",
		origin: "bundled" | "writable",
	): void {
		const raw = readFileSync(path, "utf-8");
		const parsed = parseFrontmatter(raw);
		if (!parsed) {
			this.logger.warn("Playbook missing frontmatter — skipped", { path });
			return;
		}
		const name = parsed.data.name?.trim();
		const description = parsed.data.description?.trim();
		if (!name || !description) {
			this.logger.warn("Playbook missing name/description — skipped", { path });
			return;
		}
		this.playbooks.set(name, {
			name,
			description,
			body: parsed.body,
			source,
			origin,
		});
	}

	has(name: string): boolean {
		return this.playbooks.has(name);
	}

	get(name: string): PlaybookEntry | undefined {
		return this.playbooks.get(name);
	}

	list(): PlaybookEntry[] {
		return Array.from(this.playbooks.values());
	}

	get names(): string[] {
		return Array.from(this.playbooks.keys());
	}

	/**
	 * Progressive-disclosure catalog: name + description only (NEVER the body),
	 * mirroring `SkillManager.getCatalogPrompt()`. Returns "" when empty.
	 */
	getCatalogPrompt(): string {
		const all = this.list();
		if (all.length === 0) return "";
		const lines = all.map((p) => `- **${p.name}**: ${p.description}`);
		return [
			"\n## Available Playbooks",
			"Reusable, multi-step procedures you have written for yourself. Load one with the `load_playbook` tool when a task matches its description, then follow its steps. When a genuinely reusable multi-step procedure emerges in a conversation, author a new one with `create_playbook` (it is saved only after the operator approves).",
			...lines,
			"\nOnly load a playbook when the current task matches it.",
		].join("\n");
	}

	/**
	 * Light authoring quality bar (§4): a distinct slug name, a description that
	 * states WHEN to use it, ≥2 steps, and not a near-duplicate of an existing
	 * playbook's description. Cheap by design — full consolidation is a later step.
	 */
	validateDraft(
		draft: DraftPlaybook,
		mode: "create" | "update",
	): ValidationResult {
		const name = draft.name?.trim() ?? "";
		const description = draft.description?.trim() ?? "";
		const body = draft.body ?? "";

		if (!PLAYBOOK_NAME_RE.test(name)) {
			return {
				ok: false,
				error: `invalid name "${name}" — use a lowercase, dash-separated slug (e.g. lead-intake).`,
			};
		}
		if (mode === "create" && this.has(name)) {
			return {
				ok: false,
				error: `a playbook named "${name}" already exists — use update_playbook to edit it.`,
			};
		}
		if (mode === "update" && !this.has(name)) {
			return {
				ok: false,
				error: `no playbook named "${name}" to update — use create_playbook to add it.`,
			};
		}
		if (
			description.length < 15 ||
			!/\b(when|use|after|if|for|to)\b/i.test(description)
		) {
			return {
				ok: false,
				error:
					"description must state WHEN to use the playbook (a trigger), not just what it is.",
			};
		}
		if (countSteps(body) < 2) {
			return {
				ok: false,
				error:
					"a playbook needs at least 2 steps (numbered list, bullets, or ## headings).",
			};
		}
		// Near-duplicate guard: compare against OTHER playbooks' descriptions.
		for (const existing of this.playbooks.values()) {
			if (existing.name === name) continue;
			if (similarity(existing.description, description) >= 0.8) {
				return {
					ok: false,
					error: `description is nearly identical to existing playbook "${existing.name}" — refine it or update that one instead.`,
				};
			}
		}
		return { ok: true };
	}

	/**
	 * Persist a playbook to the WRITABLE root (`<writableDir>/<name>.md`) — never
	 * the bundled root — AND refresh the live catalog (hot) so it is immediately
	 * loadable in the same session. Writing to the persistent root is what lets an
	 * authored playbook survive a redeploy. Called by the approval-queue executor
	 * AFTER a human approves the save.
	 */
	async upsert(draft: DraftPlaybook): Promise<PlaybookEntry> {
		const name = draft.name.trim();
		const description = draft.description.trim();
		if (!PLAYBOOK_NAME_RE.test(name)) {
			throw new Error(`invalid playbook name "${name}".`);
		}
		mkdirSync(this.writableDir, { recursive: true });
		const path = join(this.writableDir, `${name}.md`);
		await Bun.write(
			path,
			renderPlaybook({ name, description, body: draft.body }),
		);
		const entry: PlaybookEntry = {
			name,
			description,
			body: draft.body.trimEnd(),
			source: "file",
			origin: "writable",
		};
		this.playbooks.set(name, entry);
		return entry;
	}
}
