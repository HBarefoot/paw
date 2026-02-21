import {
	loadCredentials,
	getCredentialsPath,
} from "../../auth/credential-store.js";

export async function configCommand(): Promise<void> {
	const creds = loadCredentials();

	console.log("\n  🐾 Paw Configuration\n");

	// Auth
	console.log("  Authentication:");
	if (creds.anthropic?.method === "oauth") {
		console.log("    Anthropic: OAuth (Max/Pro subscription)");
	} else if (creds.anthropic?.apiKey) {
		const k = creds.anthropic.apiKey;
		console.log(`    Anthropic: API key (${k.slice(0, 10)}...${k.slice(-4)})`);
	} else if (process.env.ANTHROPIC_API_KEY) {
		console.log("    Anthropic: env var ANTHROPIC_API_KEY");
	} else {
		console.log("    Anthropic: not configured");
	}

	if (creds.slack?.botToken) {
		console.log("    Slack: configured");
	} else if (process.env.SLACK_BOT_TOKEN) {
		console.log("    Slack: env vars");
	} else {
		console.log("    Slack: not configured");
	}

	// Runtime settings
	console.log("\n  Runtime:");
	console.log(
		`    AI Model:    ${process.env.PAW_AI_MODEL || "claude-sonnet-4-5-20250929 (default)"}`,
	);
	console.log(
		`    Log Level:   ${process.env.PAW_LOG_LEVEL || "info (default)"}`,
	);
	console.log(
		`    DB Path:     ${process.env.PAW_DB_PATH || "./data/paw.db (default)"}`,
	);

	console.log(`\n  Credentials:   ${getCredentialsPath()}`);
	console.log("  Env overrides: ANTHROPIC_API_KEY, SLACK_BOT_TOKEN, PAW_*\n");
}
