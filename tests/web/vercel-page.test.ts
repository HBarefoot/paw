import { describe, expect, test } from "bun:test";
import type {
	ProjectSummary,
	VercelStatus,
} from "../../src/integrations/vercel/types.js";
import {
	VercelPage,
	type VercelPageProps,
	vercelScript,
} from "../../src/web/views/vercel-page.js";

function render(overrides: Partial<VercelPageProps> = {}): string {
	const base: VercelPageProps = {
		enabled: false,
		teamId: "",
		tokenInVault: false,
		vaultEnabled: true,
		initialized: false,
		status: null,
		projects: [],
	};
	return String(VercelPage({ ...base, ...overrides }));
}

describe("vercel page — status states", () => {
	test("disabled → 'Disabled' badge, no project rows", () => {
		const html = render({ enabled: false });
		expect(html).toContain("Disabled");
		expect(html).toContain("appear here once the integration is live");
	});

	test("enabled but not initialized → 'restart required' state", () => {
		const html = render({ enabled: true, initialized: false });
		expect(html).toContain("Configured — restart required");
		expect(html).toContain("Restart Paw");
	});

	test("initialized + live → 'Live' + project names", () => {
		const status: VercelStatus = {
			configured: true,
			ok: true,
			projectCount: 2,
		};
		const projects: ProjectSummary[] = [
			{ id: "prj_1", name: "my-site", framework: "nextjs" },
			{ id: "prj_2", name: "blog", framework: null },
		];
		const html = render({
			enabled: true,
			initialized: true,
			status,
			projects,
		});
		expect(html).toContain("Live");
		expect(html).toContain("my-site");
		expect(html).toContain("blog");
	});

	test("initialized + error → surfaces the error", () => {
		const status: VercelStatus = {
			configured: true,
			ok: false,
			error: "401 Unauthorized — bad token",
		};
		const html = render({ enabled: true, initialized: true, status });
		expect(html).toContain("Connection failed");
		expect(html).toContain("401 Unauthorized");
	});
});

describe("vercel page — token + vault", () => {
	test("token present → 'stored ✓' and a /vault link", () => {
		const html = render({ tokenInVault: true });
		expect(html).toContain("stored ✓");
		expect(html).toContain('href="/vault"');
	});

	test("token missing → 'missing'", () => {
		const html = render({ tokenInVault: false });
		expect(html).toContain("missing");
	});

	test("vault disabled → warns about PAW_VAULT_KEY", () => {
		const html = render({ vaultEnabled: false });
		expect(html).toContain("PAW_VAULT_KEY");
	});
});

describe("vercel page — security", () => {
	test("the token value is never rendered (it is not even a prop)", () => {
		// A token-like sentinel that would only appear if someone wired the raw
		// token into the page. It is not part of VercelPageProps by design.
		const SENTINEL = "vercel-secret-token-DO-NOT-RENDER";
		const html = render({
			enabled: true,
			initialized: true,
			tokenInVault: true,
			status: { configured: true, ok: true, projectCount: 1 },
			projects: [{ id: "prj_1", name: "site", framework: null }],
		});
		expect(html).not.toContain(SENTINEL);
		expect(html).not.toContain("Bearer ");
	});
});

describe("vercel page — inline script (template-trap guard)", () => {
	const script = vercelScript();

	test("cooked script parses without a SyntaxError", () => {
		expect(() => new Function(script)).not.toThrow();
	});

	test("exposes vcTest + vcSaveSettings, no backslash escapes / regex", () => {
		expect(script).toContain("vcTest");
		expect(script).toContain("vcSaveSettings");
		expect(script).toContain("/api/vercel/settings");
		expect(script).not.toContain("\\");
	});
});
