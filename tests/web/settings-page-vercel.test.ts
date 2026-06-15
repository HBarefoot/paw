import { describe, expect, test } from "bun:test";
import { defaults } from "../../src/config/defaults.js";
import type { PawConfig } from "../../src/types/config.js";
import {
	SettingsPage,
	type SettingsPageProps,
} from "../../src/web/views/settings-page.js";

function render(vercel: Partial<PawConfig["vercel"]>): string {
	const config: PawConfig = {
		...defaults,
		vercel: { ...defaults.vercel, ...vercel },
	};
	const props: SettingsPageProps = { config, brands: [] };
	return String(SettingsPage(props));
}

describe("settings page — Vercel integration section", () => {
	test("renders the Vercel section with enable + teamId fields", () => {
		const html = render({ enabled: true, teamId: "team_42" });
		expect(html).toContain("Vercel (deploy target)");
		expect(html).toContain('name="vercel.enabled"');
		expect(html).toContain('name="vercel.teamId"');
		expect(html).toContain("team_42");
	});

	test("the enable toggle reflects the persisted value (hidden field)", () => {
		expect(render({ enabled: true })).toContain(
			'name="vercel.enabled" value="true"',
		);
		expect(render({ enabled: false })).toContain(
			'name="vercel.enabled" value="false"',
		);
	});

	test("links to the Vault and the Vercel page, and never exposes a token field", () => {
		const html = render({ enabled: true });
		expect(html).toContain('href="/vault"');
		expect(html).toContain('href="/vercel"');
		// The token is vault-only — there must be no token input on this page.
		expect(html).not.toContain('name="vercel.token"');
	});
});
