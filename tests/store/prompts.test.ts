import { Database } from "bun:sqlite";
import { beforeEach, describe, expect, test } from "bun:test";
import {
	createPrompt,
	getPrompt,
	listPrompts,
	updatePrompt,
} from "../../src/store/prompts.js";

function freshDb(): Database {
	const db = new Database(":memory:");
	db.exec(`
    CREATE TABLE prompts (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      tags TEXT,
      use_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
	return db;
}

describe("prompts store", () => {
	let db: Database;
	beforeEach(() => {
		db = freshDb();
	});

	test("createPrompt round-trips title/body/tags", () => {
		const p = createPrompt(db, {
			title: "Summarize",
			body: "Summarize this: {text}",
			tags: "writing, summary",
		});
		expect(p.id).toBeTruthy();
		expect(p.use_count).toBe(0);
		const fetched = getPrompt(db, p.id);
		expect(fetched?.title).toBe("Summarize");
		expect(fetched?.body).toBe("Summarize this: {text}");
		expect(fetched?.tags).toBe("writing, summary");
	});

	test("duplicate creates a distinct row carrying the original body/tags", () => {
		// Backs the UI "Duplicate" action: createPrompt from an existing prompt
		// with a '(copy)' title suffix yields a new id, leaving the original intact.
		const original = createPrompt(db, {
			title: "Outreach email",
			body: "Hi {name}, ...",
			tags: "sales",
		});
		const copy = createPrompt(db, {
			title: `${original.title} (copy)`,
			body: original.body,
			tags: original.tags ?? undefined,
		});
		expect(copy.id).not.toBe(original.id);
		expect(copy.title).toBe("Outreach email (copy)");
		expect(copy.body).toBe(original.body);
		expect(copy.tags).toBe("sales");
		// Both exist independently in the library.
		expect(listPrompts(db).length).toBe(2);
		expect(getPrompt(db, original.id)?.title).toBe("Outreach email");
	});

	test("updatePrompt applies partial updates (backs inline edit via PUT)", () => {
		const p = createPrompt(db, {
			title: "Title A",
			body: "Body A",
			tags: "a",
		});
		// Update only the body — title and tags must be preserved.
		const afterBody = updatePrompt(db, p.id, { body: "Body B" });
		expect(afterBody?.body).toBe("Body B");
		expect(afterBody?.title).toBe("Title A");
		expect(afterBody?.tags).toBe("a");
		// Update only the title.
		const afterTitle = updatePrompt(db, p.id, { title: "Title B" });
		expect(afterTitle?.title).toBe("Title B");
		expect(afterTitle?.body).toBe("Body B");
		// tags can be explicitly cleared to null.
		const afterTags = updatePrompt(db, p.id, { tags: null });
		expect(afterTags?.tags).toBeNull();
	});

	test("updatePrompt returns null for an unknown id", () => {
		expect(updatePrompt(db, "does-not-exist", { title: "x" })).toBeNull();
	});
});
