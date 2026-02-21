// Anthropic OAuth for third-party apps
//
// As of January 2026, Anthropic blocks third-party tools from using
// Claude Max/Pro subscription OAuth tokens. Only the official Claude Code
// client can use subscription-based auth.
//
// See: https://github.com/anthropics/claude-code/issues/18340
//
// The supported integration path is the Anthropic API key (pay-per-use).
// If Anthropic opens up OAuth for third-party apps in the future, this
// module will implement the PKCE flow.

export async function startOAuthFlow(): Promise<never> {
	throw new Error(
		"Anthropic currently blocks third-party apps from using Max/Pro subscription OAuth.\n" +
			"  Use an API key instead: https://console.anthropic.com/settings/keys\n" +
			"  Track the feature request: https://github.com/anthropics/claude-code/issues/18340",
	);
}
