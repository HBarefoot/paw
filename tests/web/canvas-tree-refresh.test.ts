import { describe, expect, test } from "bun:test";
import { getChatScript } from "../../src/web/views/chat.js";

/**
 * The canvas workspace tree refreshes itself when the agent writes/moves/deletes
 * files mid-conversation: a `file-changed` event → debouncedRefreshFiles (300ms)
 * → loadExplorer → refetch /api/canvas/tree → renderExplorer, preserving the
 * expanded-folder set and the scroll position.
 *
 * The chat client is one giant cooked template-literal script, so we extract the
 * specific tree/poll functions by brace-balanced slicing and drive the REAL code
 * with fake timers + a fake DOM (the sanctioned "scope to the tree/poll
 * functions" approach).
 */
const script = getChatScript();

/** Slice a brace-balanced block starting at the first `{` after `marker`. */
function sliceBalanced(src: string, marker: string): string {
	const i = src.indexOf(marker);
	if (i < 0) throw new Error(`marker not found: ${marker}`);
	const open = src.indexOf("{", i);
	let depth = 0;
	for (let j = open; j < src.length; j++) {
		if (src[j] === "{") depth++;
		else if (src[j] === "}") {
			depth--;
			if (depth === 0) return src.slice(i, j + 1);
		}
	}
	throw new Error(`unbalanced block: ${marker}`);
}

describe("canvas tree refresh — debounce", () => {
	function makeDebounce() {
		const timers: Array<{ id: number; cb: () => void }> = [];
		let nextId = 1;
		const setT = (cb: () => void) => {
			const id = nextId++;
			timers.push({ id, cb });
			return id;
		};
		const clrT = (id: number) => {
			const k = timers.findIndex((t) => t.id === id);
			if (k >= 0) timers.splice(k, 1);
		};
		let loadCount = 0;
		const win = {
			loadExplorer: () => {
				loadCount += 1;
			},
		};
		const body = `var _canvasFileListTimer = null;\n${sliceBalanced(
			script,
			"function debouncedRefreshFiles(",
		)}\nreturn debouncedRefreshFiles;`;
		const make = new Function(
			"setTimeout",
			"clearTimeout",
			"refreshCanvasFiles",
			"window",
			body,
		);
		const debounced = make(setT, clrT, () => {}, win) as () => void;
		return { debounced, timers, getLoadCount: () => loadCount };
	}

	test("a burst of file-changed events collapses to one tree refetch", () => {
		const { debounced, timers, getLoadCount } = makeDebounce();
		for (let i = 0; i < 5; i++) debounced(); // burst within the window
		expect(timers.length).toBe(1); // earlier timers cleared
		timers[0].cb(); // window elapses
		expect(getLoadCount()).toBe(1); // exactly one refresh
	});

	test("no event → no refresh is scheduled or fired", () => {
		const { timers, getLoadCount } = makeDebounce();
		expect(timers.length).toBe(0);
		expect(getLoadCount()).toBe(0);
	});
});

describe("canvas tree refresh — render preserves state", () => {
	// Build a runnable scope with the real tree functions + stubbed leaf deps.
	function makeExplorer(expanded: Set<string>) {
		let innerHTML = "";
		let scrollTop = 0;
		const treeEl = {
			get innerHTML() {
				return innerHTML;
			},
			set innerHTML(v: string) {
				innerHTML = v;
				scrollTop = 0; // a real browser resets scroll when innerHTML changes
			},
			get scrollTop() {
				return scrollTop;
			},
			set scrollTop(v: number) {
				scrollTop = v;
			},
		};
		const doc = {
			getElementById: (id: string) => (id === "explorer-tree" ? treeEl : null),
			querySelectorAll: () => [] as unknown[],
		};
		let treeUrlFetches = 0;
		const fetchStub = (url: string) => {
			if (url.indexOf("/api/canvas/tree") !== -1) treeUrlFetches += 1;
			return Promise.resolve({
				json: () =>
					Promise.resolve({
						entries: [
							{ path: "src", type: "dir" },
							{ path: "src/app.js", type: "file" },
							{ path: "index.html", type: "file" },
						],
					}),
			});
		};
		const win: Record<string, unknown> = {};
		const body = [
			"var explorerEntries = [];",
			"var explorerExpanded = __expanded;",
			"function saveExplorerExpanded(){}",
			"var canvasCurrentFileName = '__home__';",
			"function findOrCreateTab(){}",
			"function runContentSearch(){}",
			"function refreshCanvasFiles(){}",
			sliceBalanced(script, "function buildTree("),
			sliceBalanced(script, "function renderNode("),
			sliceBalanced(script, "function renderExplorer("),
			sliceBalanced(script, "function bindTreeRows("),
			sliceBalanced(script, "window.loadExplorer = function"),
			"return { loadExplorer: window.loadExplorer, tree: __tree };",
		].join("\n");
		const make = new Function(
			"window",
			"document",
			"fetch",
			"__expanded",
			"__tree",
			body,
		);
		const api = make(win, doc, fetchStub, expanded, treeEl) as {
			loadExplorer: () => void;
			tree: typeof treeEl;
		};
		return { api, treeEl, getTreeFetches: () => treeUrlFetches };
	}

	test("loadExplorer refetches the tree once and keeps the expanded set", async () => {
		const expanded = new Set<string>(["src"]);
		const { api, getTreeFetches } = makeExplorer(expanded);
		api.loadExplorer();
		await Promise.resolve();
		await Promise.resolve();
		expect(getTreeFetches()).toBe(1);
		// The open folder is still open after the refresh.
		expect(expanded.has("src")).toBe(true);
	});

	test("scroll position survives a refresh", async () => {
		const expanded = new Set<string>(["src"]);
		const { api, treeEl } = makeExplorer(expanded);
		treeEl.scrollTop = 120; // user scrolled down
		api.loadExplorer();
		await Promise.resolve();
		await Promise.resolve();
		// renderExplorer reset innerHTML (→ scrollTop 0) then restored it.
		expect(treeEl.scrollTop).toBe(120);
	});
});

describe("chat script still parses (scroll-restore edit didn't break the cook)", () => {
	test("cooked script compiles", () => {
		expect(() => new Function(script)).not.toThrow();
	});
});
