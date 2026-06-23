import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

// feat/operator-unblock-phase1 — board render rules for the help-leash. A blocked
// card normally shows a feedback→Resume form, but a `needs_capability` block can't
// be cleared by an operator note (no tool/feature exists), so the board must show a
// "needs dev work" hint and NO Resume action. These assertions fail on pre-change
// code (the renderCard seam is absent → window.TasksBoard.renderCard is undefined).

const SRC = readFileSync(
	new URL("../../src/web/public/tasks/board.js", import.meta.url),
	"utf8",
);

// ── minimal fake DOM (renderCard only does createElement + append/text/attr) ──
// biome-ignore lint/suspicious/noExplicitAny: intentionally untyped test stub
type Any = any;
function makeNode(tag: string): Any {
	return {
		tagName: tag,
		className: "",
		textContent: "",
		childNodes: [] as Any[],
		appendChild(child: Any) {
			this.childNodes.push(child);
			return child;
		},
		setAttribute() {},
		addEventListener() {},
	};
}

/** Load board.js into a fresh fake window and return window.TasksBoard. */
function loadBoard(): Any {
	const win: Any = {};
	const documentStub = { createElement: (tag: string) => makeNode(tag) };
	// fetch/setTimeout exist only so the IIFE evaluates; renderCard never calls them.
	new Function("window", "document", "fetch", "setTimeout", SRC)(
		win,
		documentStub,
		() => Promise.resolve({ ok: true, json: () => ({}) }),
		() => 0,
	);
	return win.TasksBoard;
}

/** Flatten a rendered node tree into the text of every node + a tag list. */
function walk(node: Any): { texts: string[]; tags: string[] } {
	const texts: string[] = [];
	const tags: string[] = [];
	const visit = (n: Any) => {
		tags.push(String(n.tagName));
		if (n.textContent) texts.push(String(n.textContent));
		for (const c of n.childNodes) visit(c);
	};
	visit(node);
	return { texts, tags };
}

function card(over: Record<string, unknown>): Any {
	return {
		id: "c1",
		title: "Sweep leads",
		priority: "normal",
		status: "blocked",
		error: "could not finish",
		block_kind: null,
		operator_note: null,
		due_at: null,
		agent_name: null,
		evidence: null,
		overdue: false,
		...over,
	};
}

describe("board.js renderCard — help-leash", () => {
	test("needs_capability: shows a 'needs dev work' hint and NO Resume action", () => {
		const board = loadBoard();
		expect(typeof board.renderCard).toBe("function");
		const { texts, tags } = walk(
			board.renderCard(card({ block_kind: "needs_capability" })),
		);
		// The dev-work hint is present…
		expect(texts.some((t) => t.includes("Needs dev work"))).toBe(true);
		// …and there is no Resume button and no note input.
		expect(texts).not.toContain("Resume");
		expect(tags).not.toContain("input");
	});

	test("needs_feedback: shows the Resume form (button + note input + secrets hint)", () => {
		const board = loadBoard();
		const { texts, tags } = walk(
			board.renderCard(card({ block_kind: "needs_feedback" })),
		);
		expect(texts).toContain("Resume");
		expect(tags).toContain("input");
		expect(texts.some((t) => t.includes("Don't paste secrets"))).toBe(true);
	});
});
