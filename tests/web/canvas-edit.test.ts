import { describe, expect, it } from "bun:test";
import {
	EDITABLE_TAGS,
	escapeHtml,
	isEditableLeaf,
	spliceEditById,
	stampEditAnchors,
} from "../../src/web/canvas-edit.js";

// A representative page: editable text leaves, a NON-leaf parent (text + element
// child), a nested editable leaf, a <script> with `<` that must survive parsing,
// and an entity in text. The persistence promise is that everything OUTSIDE the
// edited element's inner text stays byte-identical.
const PAGE = `<!DOCTYPE html><html><head><title>T</title></head><body>
<h1>Hello</h1>
<p class="lead">World &amp; co</p>
<div class="card"><p>intro <a href="/x">link</a></p></div>
<button>Go</button>
<script>var a = 1 < 2 && 3 > 0; document.title = "x";</script>
</body></html>`;

describe("stampEditAnchors", () => {
	it("stamps text-leaf elements with data-edit-id in document order", () => {
		const { html, changed } = stampEditAnchors(PAGE);
		expect(changed).toBe(true);
		// h1, p.lead, the inner <a> (leaf), and <button> are leaves → stamped.
		expect(html).toContain('<h1 data-edit-id="e1">Hello</h1>');
		expect(html).toContain(
			'<p class="lead" data-edit-id="e2">World &amp; co</p>',
		);
		// The outer <p>intro <a>…</a></p> has an element child → NOT a leaf → unstamped.
		expect(html).toContain('<div class="card"><p>intro ');
		expect(html).not.toMatch(/<p data-edit-id="[^"]*">intro/);
	});

	it("leaves the <script> and surrounding markup byte-identical", () => {
		const { html } = stampEditAnchors(PAGE);
		expect(html).toContain(
			'<script>var a = 1 < 2 && 3 > 0; document.title = "x";</script>',
		);
		expect(html).toContain(
			"<!DOCTYPE html><html><head><title>T</title></head>",
		);
	});

	it("is append-only and idempotent (re-stamp adds nothing, never renumbers)", () => {
		const once = stampEditAnchors(PAGE).html;
		const twice = stampEditAnchors(once);
		expect(twice.changed).toBe(false);
		expect(twice.html).toBe(once);
		// A newly added leaf continues the numbering past the existing max.
		const withNew = once.replace("</body>", "<h2>New</h2></body>");
		const after = stampEditAnchors(withNew);
		expect(after.changed).toBe(true);
		// existing ids are preserved …
		expect(after.html).toContain('<h1 data-edit-id="e1">Hello</h1>');
		// … and the new leaf gets the next id, not a reused one.
		expect(after.html).toMatch(/<h2 data-edit-id="e\d+">New<\/h2>/);
		expect(after.html).not.toContain('data-edit-id="e1">New');
	});
});

describe("spliceEditById", () => {
	const stamped = stampEditAnchors(PAGE).html;

	it("replaces ONLY the inner text; everything else is byte-identical", () => {
		const r = spliceEditById(stamped, "e1", "Hi there", "Hello");
		expect(r.ok).toBe(true);
		if (r.ok) {
			expect(r.html).toContain('<h1 data-edit-id="e1">Hi there</h1>');
			// The script and the rest of the document are untouched.
			expect(r.html).toContain(
				'<script>var a = 1 < 2 && 3 > 0; document.title = "x";</script>',
			);
			// Identical except the 5-char "Hello" → "Hi there".
			expect(r.html).toBe(stamped.replace(">Hello<", ">Hi there<"));
		}
	});

	it("round-trip guard: a stale originalText is rejected (no clobber)", () => {
		const r = spliceEditById(stamped, "e1", "X", "Not what was there");
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.error).toBe("stale");
	});

	it("the guard compares DECODED text (source entity vs DOM text)", () => {
		// Source is "World &amp; co"; the editor saw "World & co".
		const r = spliceEditById(stamped, "e2", "Updated", "World & co");
		expect(r.ok).toBe(true);
	});

	it("HTML-escapes the new text (no stored XSS)", () => {
		const r = spliceEditById(
			stamped,
			"e1",
			'<img src=x onerror=alert(1)> & "q"',
			"Hello",
		);
		expect(r.ok).toBe(true);
		if (r.ok) {
			expect(r.html).toContain(
				'<h1 data-edit-id="e1">&lt;img src=x onerror=alert(1)&gt; &amp; "q"</h1>',
			);
			expect(r.html).not.toContain("<img src=x onerror");
		}
	});

	it("returns not_found for an unknown anchor", () => {
		const r = spliceEditById(stamped, "e999", "x", "y");
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.error).toBe("not_found");
	});
});

describe("editable allowlist + escapeHtml", () => {
	it("EDITABLE_TAGS covers text leaves only", () => {
		for (const t of ["h1", "p", "span", "a", "li", "button"])
			expect(EDITABLE_TAGS.has(t)).toBe(true);
		for (const t of ["div", "section", "script", "img"])
			expect(EDITABLE_TAGS.has(t)).toBe(false);
	});

	it("escapeHtml escapes &, <, >", () => {
		expect(escapeHtml("a & b < c > d")).toBe("a &amp; b &lt; c &gt; d");
	});

	it("isEditableLeaf is exported and callable", () => {
		expect(typeof isEditableLeaf).toBe("function");
	});
});
