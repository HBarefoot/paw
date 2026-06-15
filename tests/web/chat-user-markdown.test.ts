import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { getChatScript } from "../../src/web/views/chat.js";

// User chat messages now render markdown (like assistant) so a quoted message
// (`> ...` from the Quote action) shows a styled blockquote instead of literal
// ">" lines. These fail on the pre-fix code (user body was escapeHtml only,
// blockquote CSS scoped to .msg.assistant).

const DS_CSS = readFileSync(
	fileURLToPath(new URL("../../src/web/public/app/ds.css", import.meta.url)),
	"utf8",
);

describe("user chat messages render markdown (Quote styling fix)", () => {
	const script = getChatScript();

	test("cooked script still parses (inline-script-template-trap guard)", () => {
		expect(() => new Function(script)).not.toThrow();
	});

	test("the message bubble no longer renders the user body as escaped plain text", () => {
		// Pre-fix the user branch did: '</div>' + escapeHtml(text)
		expect(script).not.toContain("'</div>' + escapeHtml(text)");
	});

	test("messages render through renderMarkdown into a .md-content div", () => {
		expect(script).toContain('mdDiv.className = "md-content"');
		expect(script).toContain("mdDiv.innerHTML = renderMarkdown(text)");
	});

	test("blockquote (and markdown) styling applies to all messages, not just assistant", () => {
		expect(DS_CSS).toContain(".msg .md-content blockquote");
		expect(DS_CSS).not.toContain(".msg.assistant .md-content");
	});
});
