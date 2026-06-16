import { describe, expect, test } from "bun:test";
import {
	type SecretStatus,
	VaultPage,
} from "../../src/web/views/vault-page.js";

const providerCredentials: SecretStatus[] = [
	{ id: "anthropic", label: "Anthropic API key", set: true, fromEnv: true },
	{ id: "openai", label: "OpenAI API key", set: false },
];

function render(over?: { enabled?: boolean }): string {
	return String(
		VaultPage({
			enabled: over?.enabled ?? true,
			secrets: [],
			slots: [],
			providerCredentials,
		}),
	);
}

describe("vault page — relocated Provider credentials (formerly /settings Secrets)", () => {
	test("renders a Provider credentials table with each service + Rotate button", () => {
		const html = render();
		expect(html).toContain("Provider credentials");
		expect(html).toContain("Anthropic API key");
		expect(html).toContain("OpenAI API key");
		expect(html).toContain(
			"rotateSecret(this.dataset.secretId, this.dataset.secretLabel)",
		);
		expect(html).toContain('data-secret-id="anthropic"');
	});

	test("Set/Missing status + source render from the prop", () => {
		const html = render();
		expect(html).toContain("Set");
		expect(html).toContain("Missing");
		expect(html).toContain("env var");
	});

	test("Provider credentials render even when the vault is disabled", () => {
		// The card uses /api/credentials, independent of the vault master key.
		const html = render({ enabled: false });
		expect(html).toContain("Provider credentials");
		expect(html).toContain("Anthropic API key");
	});

	test("empty provider-credential list shows the empty message, not a table", () => {
		const html = String(
			VaultPage({
				enabled: true,
				secrets: [],
				slots: [],
				providerCredentials: [],
			}),
		);
		expect(html).toContain("No provider credentials configured.");
	});

	test("inline script defines rotateSecret hitting /api/credentials and parses (template-trap guard)", () => {
		const html = render();
		// The page renders several scripts via Layout; target the vault one.
		const at = html.indexOf("function rotateSecret(");
		const open = html.lastIndexOf("<script>", at);
		const close = html.indexOf("</script>", at);
		const script = html.slice(open + "<script>".length, close);
		expect(script).toContain("function rotateSecret(");
		expect(script).toContain("/api/credentials/");
		expect(() => new Function(script)).not.toThrow();
	});
});
