import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// pawModal._show escapes a string `body` via textContent (an XSS-hardening
// tradeoff). Callers that pass an HTML string get the raw markup rendered as
// literal text — the recurring "raw markup in a modal" trap (prompt picker,
// memory viewer). The guard below warns (dev-only) when a string body looks
// like HTML so the trap can't recur silently. This test pins the guard.
const LAYOUT_SRC = readFileSync(
	fileURLToPath(new URL("../../src/web/views/layout.tsx", import.meta.url)),
	"utf8",
);

describe("pawModal string-body HTML guard", () => {
	test("_show warns when a string body looks like HTML (closing tag)", () => {
		// REGRESSION: fails on the pre-guard code. The check keys off a closing
		// tag `</` — a strong HTML signal with near-zero false positives in prose —
		// and uses no regex/backslashes (this lives in a template literal: the trap).
		expect(LAYOUT_SRC).toContain('bodyStr.indexOf("</") !== -1');
		expect(LAYOUT_SRC).toContain("pawModal: string body looks like HTML");
		expect(LAYOUT_SRC).toContain("Pass a DOM Node to render it");
	});

	test("the guard does not use a regex literal (template-literal trap)", () => {
		// The guard sits inside the `modalScript` template literal, where a regex
		// literal's backslashes get cooked away. It must use indexOf, not a regex.
		expect(LAYOUT_SRC).not.toContain("body.match(/<");
		expect(LAYOUT_SRC).not.toContain("test(bodyStr)");
	});
});
