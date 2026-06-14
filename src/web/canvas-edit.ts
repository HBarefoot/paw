// Inline click-to-edit persistence for served canvas pages. Maps a DOM text edit
// back to the STORED HTML source by stable `data-edit-id` anchors, then patches
// ONLY the element's inner-text byte range — never re-serializing the document
// (which would destroy scripts, formatting, and the injected runtime). Uses
// parse5 with `sourceCodeLocationInfo` to locate byte ranges; everything outside
// the spliced range is byte-identical.
//
// Pure module (no I/O) so it is unit-testable in isolation; the owner-only routes
// in app.ts read the file, call these, and write through the shared canvas-write
// path. v1 scope: STRICT TEXT LEAVES only (elements whose children are all text
// nodes). Inline-formatted paragraphs (nested <strong>/<a>) are a fast-follow.

import { type DefaultTreeAdapterMap, parse } from "parse5";

type PNode = DefaultTreeAdapterMap["node"];
type PElement = DefaultTreeAdapterMap["element"];
type PTextNode = DefaultTreeAdapterMap["textNode"];

/** Text-leaf elements an admin may edit inline. */
export const EDITABLE_TAGS = new Set([
	"h1",
	"h2",
	"h3",
	"h4",
	"h5",
	"h6",
	"p",
	"span",
	"a",
	"li",
	"td",
	"th",
	"button",
	"label",
	"blockquote",
	"figcaption",
	"small",
	"strong",
	"em",
	"b",
	"i",
]);

function isElement(n: PNode): n is PElement {
	return typeof (n as PElement).tagName === "string";
}
function isText(n: PNode): n is PTextNode {
	return n.nodeName === "#text";
}
function getAttr(el: PElement, name: string): string | undefined {
	return el.attrs.find((a) => a.name === name)?.value;
}

/** An editable leaf: an allowlisted tag whose children are ALL text nodes (no
 *  element children — so the inner content is a single contiguous text range). */
export function isEditableLeaf(el: PElement): boolean {
	if (!EDITABLE_TAGS.has(el.tagName)) return false;
	return el.childNodes.every(isText);
}

/** Decoded text content of an element (parse5 already entity-decodes text-node
 *  values), used for the optimistic-concurrency / round-trip guard. */
function textOf(el: PElement): string {
	return el.childNodes
		.filter(isText)
		.map((t) => t.value)
		.join("");
}

/** Escape plain text for insertion into HTML text content. */
export function escapeHtml(s: string): string {
	return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function walkElements(node: PNode, visit: (el: PElement) => void): void {
	if (isElement(node)) visit(node);
	if ("childNodes" in node && Array.isArray(node.childNodes)) {
		for (const child of node.childNodes) walkElements(child, visit);
	}
}

export interface EditAnchor {
	editId: string;
	tag: string;
	text: string;
}

/**
 * List every anchored editable element in document order: its `data-edit-id`,
 * tag name, and current decoded text. Lets the agent see what it can change (and
 * pick an editId + originalText) without touching the live DOM. Call on
 * already-stamped HTML (run stampEditAnchors first).
 */
export function listEditAnchors(html: string): EditAnchor[] {
	const doc = parse(html, { sourceCodeLocationInfo: true });
	const out: EditAnchor[] = [];
	walkElements(doc, (el) => {
		const editId = getAttr(el, "data-edit-id");
		if (editId && isEditableLeaf(el)) {
			out.push({ editId, tag: el.tagName, text: textOf(el) });
		}
	});
	return out;
}

/**
 * Assign stable, append-only `data-edit-id="eN"` anchors to every editable leaf
 * that lacks one, by splicing the attribute into each start tag at its source
 * location. Existing anchors are preserved and never renumbered (N continues past
 * the current max). Returns the new HTML and whether anything changed. Pure
 * string patching — the tree is never serialized.
 */
export function stampEditAnchors(html: string): {
	html: string;
	changed: boolean;
} {
	const doc = parse(html, { sourceCodeLocationInfo: true });
	let maxN = 0;
	const pending: PElement[] = [];
	walkElements(doc, (el) => {
		const existing = getAttr(el, "data-edit-id");
		if (existing) {
			const m = /^e(\d+)$/.exec(existing);
			if (m) maxN = Math.max(maxN, Number(m[1]));
			return;
		}
		if (isEditableLeaf(el)) pending.push(el);
	});

	// Build insertions (offset → text), then apply LAST→FIRST so earlier offsets
	// stay valid as the string grows.
	const inserts: Array<{ offset: number; text: string }> = [];
	let n = maxN;
	for (const el of pending) {
		const startTag = el.sourceCodeLocation?.startTag;
		if (!startTag) continue; // can't safely stamp without a located start tag
		n += 1;
		// Insert just before the closing ">" of the start tag.
		inserts.push({
			offset: startTag.endOffset - 1,
			text: ` data-edit-id="e${n}"`,
		});
	}
	if (inserts.length === 0) return { html, changed: false };

	inserts.sort((a, b) => b.offset - a.offset);
	let out = html;
	for (const ins of inserts) {
		out = out.slice(0, ins.offset) + ins.text + out.slice(ins.offset);
	}
	return { html: out, changed: true };
}

export type SpliceResult =
	| { ok: true; html: string }
	| { ok: false; error: "not_found" | "no_location" | "stale" };

/**
 * Replace the inner text of the element carrying `data-edit-id === editId` with
 * `newText` (HTML-escaped), splicing ONLY that byte range. Round-trip guard: the
 * element's current decoded text must equal `originalText` (what the editor saw),
 * else `{ error: "stale" }` — the caller surfaces "page changed, reload" instead
 * of clobbering. Everything outside the inner range is byte-identical.
 */
export function spliceEditById(
	html: string,
	editId: string,
	newText: string,
	originalText: string,
): SpliceResult {
	const doc = parse(html, { sourceCodeLocationInfo: true });
	const matches: PElement[] = [];
	walkElements(doc, (e) => {
		if (getAttr(e, "data-edit-id") === editId) matches.push(e);
	});
	const el = matches[0];
	if (!el) return { ok: false, error: "not_found" };

	const loc = el.sourceCodeLocation;
	if (!loc?.startTag || !loc.endTag) return { ok: false, error: "no_location" };

	if (textOf(el) !== originalText) return { ok: false, error: "stale" };

	const innerStart = loc.startTag.endOffset;
	const innerEnd = loc.endTag.startOffset;
	const out =
		html.slice(0, innerStart) + escapeHtml(newText) + html.slice(innerEnd);
	return { ok: true, html: out };
}
