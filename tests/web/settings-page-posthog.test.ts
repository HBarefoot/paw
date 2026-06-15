import { describe, expect, test } from "bun:test";
import { defaults } from "../../src/config/defaults.js";
import type { PawConfig } from "../../src/types/config.js";
import {
	SettingsPage,
	type SettingsPageProps,
} from "../../src/web/views/settings-page.js";

function render(posthog: Partial<PawConfig["posthog"]>): string {
	const config: PawConfig = {
		...defaults,
		posthog: { ...defaults.posthog, ...posthog },
	};
	const props: SettingsPageProps = { config, brands: [] };
	return String(SettingsPage(props));
}

describe("settings page — PostHog integration section", () => {
	test("renders the PostHog section with enable + projectApiKey + projectId + host", () => {
		const html = render({
			enabled: true,
			projectApiKey: "phc_pub",
			projectId: "12345",
			host: "https://eu.i.posthog.com",
		});
		expect(html).toContain("PostHog (analytics)");
		expect(html).toContain('name="posthog.enabled"');
		expect(html).toContain('name="posthog.projectApiKey"');
		expect(html).toContain('name="posthog.projectId"');
		expect(html).toContain('name="posthog.host"');
		expect(html).toContain("phc_pub");
		expect(html).toContain("12345");
		expect(html).toContain("https://eu.i.posthog.com");
	});

	test("the enable toggle reflects the persisted value (hidden field)", () => {
		expect(render({ enabled: true })).toContain(
			'name="posthog.enabled" value="true"',
		);
		expect(render({ enabled: false })).toContain(
			'name="posthog.enabled" value="false"',
		);
	});

	test("links to the Vault and never exposes the personal API key field", () => {
		const html = render({ enabled: true });
		expect(html).toContain('href="/vault"');
		expect(html).toContain("posthog.personalApiKey");
		// ...only as the vault-slot reference text, NEVER as an input field.
		expect(html).not.toContain('name="posthog.personalApiKey"');
	});

	test("offers a live connection check", () => {
		expect(render({ enabled: true })).toContain('id="posthog-status"');
	});
});
