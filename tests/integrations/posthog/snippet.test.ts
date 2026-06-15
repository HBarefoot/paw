import { describe, expect, test } from "bun:test";
import {
	POSTHOG_MARKER,
	buildPostHogSnippet,
	injectPostHogSnippet,
} from "../../../src/integrations/posthog/snippet.js";

const KEY = "phc_PUBLIC_project_key";
const HOST = "https://us.i.posthog.com";
const PAGE =
	"<!doctype html><html><head><title>Hi</title></head><body>x</body></html>";

describe("PostHog snippet (instrument)", () => {
	test("init embeds the PUBLIC project key + host", () => {
		const s = buildPostHogSnippet({ projectApiKey: KEY, host: HOST });
		expect(s).toContain(`posthog.init("${KEY}"`);
		expect(s).toContain(`api_host:"${HOST}"`);
		// privacy-friendly, cookieless defaults
		expect(s).toContain("persistence:'memory'");
		expect(s).toContain("autocapture:false");
		expect(s).toContain("person_profiles:'identified_only'");
	});

	test("injects into <head> when enabled", () => {
		const out = injectPostHogSnippet(PAGE, { projectApiKey: KEY, host: HOST });
		expect(out).toContain(POSTHOG_MARKER);
		expect(out).toContain(`posthog.init("${KEY}"`);
		// placed inside <head>, before </head>
		expect(out.indexOf(POSTHOG_MARKER)).toBeGreaterThan(out.indexOf("<head"));
		expect(out.indexOf(POSTHOG_MARKER)).toBeLessThan(out.indexOf("</head>"));
		// still one head, still has the body
		expect(out.match(/<head/gi)).toHaveLength(1);
		expect(out).toContain("<body>x</body>");
	});

	test("absent when no project key is configured", () => {
		const out = injectPostHogSnippet(PAGE, { projectApiKey: "", host: HOST });
		expect(out).toBe(PAGE);
		expect(out).not.toContain(POSTHOG_MARKER);
	});

	test("dedupes — injecting twice yields exactly one snippet", () => {
		const once = injectPostHogSnippet(PAGE, { projectApiKey: KEY, host: HOST });
		const twice = injectPostHogSnippet(once, {
			projectApiKey: KEY,
			host: HOST,
		});
		expect(twice).toBe(once);
		expect(twice.match(new RegExp(POSTHOG_MARKER))?.length).toBe(1);
		expect([...twice.matchAll(/posthog\.init\(/g)]).toHaveLength(1);
	});

	test("no <head> → snippet is prepended (analytics still load)", () => {
		const out = injectPostHogSnippet("<div>bare</div>", {
			projectApiKey: KEY,
			host: HOST,
		});
		expect(out.startsWith(POSTHOG_MARKER)).toBe(true);
		expect(out).toContain("<div>bare</div>");
	});

	test("the PRIVATE personal API key is never referenced by the builder", () => {
		// The injector takes only {projectApiKey, host} — there is no code path
		// that could embed a personal key. Guard the output explicitly.
		const PERSONAL = "phx_PRIVATE_personal_key";
		const out = injectPostHogSnippet(PAGE, { projectApiKey: KEY, host: HOST });
		expect(out).not.toContain(PERSONAL);
		expect(out).not.toContain("personalApiKey");
	});
});
