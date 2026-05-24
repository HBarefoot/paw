import type { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";

export interface StoredPrompt {
	id: string;
	title: string;
	body: string;
	tags: string | null;
	use_count: number;
	created_at: string;
	updated_at: string;
}

const MAX_TITLE_LEN = 120;
const MAX_BODY_LEN = 20_000;
const MAX_TAGS_LEN = 200;

function sanitizeTitle(value: string): string {
	return value.replace(/\s+/g, " ").trim().slice(0, MAX_TITLE_LEN);
}

function sanitizeTags(value: string | null | undefined): string | null {
	if (!value) return null;
	const cleaned = value.replace(/\s+/g, " ").trim().slice(0, MAX_TAGS_LEN);
	return cleaned || null;
}

export function listPrompts(db: Database, limit = 200): StoredPrompt[] {
	return db
		.prepare<StoredPrompt, [number]>(
			"SELECT * FROM prompts ORDER BY updated_at DESC LIMIT ?",
		)
		.all(limit);
}

export function getPrompt(db: Database, id: string): StoredPrompt | null {
	return (
		db
			.prepare<StoredPrompt, [string]>(
				"SELECT * FROM prompts WHERE id = ?",
			)
			.get(id) ?? null
	);
}

export function createPrompt(
	db: Database,
	input: { title: string; body: string; tags?: string },
): StoredPrompt {
	const id = randomUUID();
	const title = sanitizeTitle(input.title);
	if (!title) throw new Error("Prompt title is required");
	const body = input.body.slice(0, MAX_BODY_LEN);
	if (!body.trim()) throw new Error("Prompt body is required");
	const tags = sanitizeTags(input.tags);

	db.run(
		"INSERT INTO prompts (id, title, body, tags) VALUES (?, ?, ?, ?)",
		[id, title, body, tags],
	);
	return getPrompt(db, id)!;
}

export function updatePrompt(
	db: Database,
	id: string,
	input: { title?: string; body?: string; tags?: string | null },
): StoredPrompt | null {
	const current = getPrompt(db, id);
	if (!current) return null;

	const title =
		input.title !== undefined
			? sanitizeTitle(input.title) || current.title
			: current.title;
	const body =
		input.body !== undefined
			? input.body.slice(0, MAX_BODY_LEN) || current.body
			: current.body;
	const tags =
		input.tags !== undefined
			? sanitizeTags(input.tags)
			: current.tags;

	db.run(
		"UPDATE prompts SET title = ?, body = ?, tags = ?, updated_at = datetime('now') WHERE id = ?",
		[title, body, tags, id],
	);
	return getPrompt(db, id);
}

export function deletePrompt(db: Database, id: string): boolean {
	const result = db.run("DELETE FROM prompts WHERE id = ?", [id]);
	return result.changes > 0;
}

export function recordPromptUse(db: Database, id: string): void {
	db.run(
		"UPDATE prompts SET use_count = use_count + 1, updated_at = datetime('now') WHERE id = ?",
		[id],
	);
}
