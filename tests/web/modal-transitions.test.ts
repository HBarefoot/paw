import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Layout } from "../../src/web/views/layout.js";

// feat/ui-polish-flash-and-modals — pawModal must fade+scale on BOTH open and
// close. The pre-change _close removed the overlay instantly (it vanished); the
// new one animates out via a `closing` class and removes on transitionend with a
// timeout fallback. Reduced-motion users get instant show/hide. The API is
// unchanged. These pin the behavior (and guard the template-literal trap).

const LAYOUT_SRC = readFileSync(
	fileURLToPath(new URL("../../src/web/views/layout.tsx", import.meta.url)),
	"utf8",
);

/** The inline modal <script> from the rendered Layout HTML. */
function modalScriptFromHtml(): string {
	const html = String(Layout({ title: "x", currentPath: "/", children: "x" }));
	const marker = "window.pawModal";
	const mi = html.indexOf(marker);
	expect(mi).toBeGreaterThan(-1);
	const open = html.lastIndexOf("<script>", mi) + "<script>".length;
	const end = html.indexOf("</script>", mi);
	return html.slice(open, end);
}

describe("pawModal open/close animation (modalScript)", () => {
	test("the modal script cooks and parses (inline-script-template-trap guard)", () => {
		expect(() => new Function(modalScriptFromHtml())).not.toThrow();
	});

	test("_close animates out (closing class) and removes on transitionend, not instantly", () => {
		// REGRESSION: pre-change _close was a one-liner `overlay.remove()`.
		expect(LAYOUT_SRC).toContain('overlay.classList.add("closing")');
		expect(LAYOUT_SRC).toContain('addEventListener("transitionend"');
		// A fallback so a missed transitionend can't leak the overlay.
		expect(LAYOUT_SRC).toContain("setTimeout(done");
	});

	test("_show animates in by flipping .open on a later frame (not instant)", () => {
		expect(LAYOUT_SRC).toContain('overlay.classList.add("open")');
		expect(LAYOUT_SRC).toContain("requestAnimationFrame");
	});

	test("reduced motion is respected (instant show/hide)", () => {
		expect(LAYOUT_SRC).toContain("prefers-reduced-motion: reduce");
		expect(LAYOUT_SRC).toContain("_reducedMotion");
	});

	test("the modal API is unchanged (alert/confirm/prompt + Escape close)", () => {
		expect(LAYOUT_SRC).toContain("alert: function");
		expect(LAYOUT_SRC).toContain("confirm: function");
		expect(LAYOUT_SRC).toContain("prompt: function");
		expect(LAYOUT_SRC).toContain("window.pawModal._close()");
	});
});

describe("ds.css modal transition styles", () => {
	const CSS = readFileSync(
		fileURLToPath(new URL("../../src/web/public/app/ds.css", import.meta.url)),
		"utf8",
	);

	test("overlay + modal transition opacity/transform with .open and .closing states", () => {
		expect(CSS).toContain(".paw-modal-overlay.open");
		expect(CSS).toContain(".paw-modal-overlay.closing");
		expect(CSS).toContain("transition: opacity 170ms ease-out");
		expect(CSS).toContain(
			"transition: opacity 170ms ease-out, transform 170ms ease-out",
		);
	});

	test("reduced-motion disables the modal transition", () => {
		// The modal block carries its own reduced-motion guard.
		expect(CSS).toContain(
			".paw-modal-overlay, .paw-modal { transition: none; }",
		);
	});

	test("the old always-on keyframe animations are gone (they couldn't animate close)", () => {
		expect(CSS).not.toContain("pawModalFadeIn");
		expect(CSS).not.toContain("pawModalSlideIn");
	});
});
