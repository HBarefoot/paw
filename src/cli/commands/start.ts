import { existsSync, renameSync } from "node:fs";
import { Kernel } from "../../kernel/kernel.js";
import { loadConfig } from "../../config/loader.js";
import {
	getAnthropicCredentials,
	getStoredProvider,
	getOllamaConfig,
} from "../../auth/credential-store.js";

export async function startCommand(): Promise<void> {
	const provider = getStoredProvider();

	if (provider === "ollama") {
		const ollama = getOllamaConfig();
		if (!ollama) {
			console.error("\n  ✗ No Ollama configuration found.\n");
			console.error("  Run: paw init\n");
			process.exit(1);
		}
		console.log(`\n  Using: Ollama (${ollama.model} @ ${ollama.baseUrl})`);
	} else {
		const creds = getAnthropicCredentials();
		if (!creds) {
			console.error("\n  ✗ No Anthropic credentials found.\n");
			console.error("  Run one of:");
			console.error("    paw init           # Interactive setup wizard");
			console.error("    paw auth login     # Just authenticate\n");
			process.exit(1);
		}
		const method =
			creds.method === "oauth" ? "OAuth (Max/Pro subscription)" : "API key";
		console.log(`\n  Using: Claude — ${method}`);
	}

	const config = loadConfig();

	// Migrate legacy database file
	const legacyDb = config.store.dbPath.replace("paw.db", "clawme.db");
	if (
		legacyDb !== config.store.dbPath &&
		existsSync(legacyDb) &&
		!existsSync(config.store.dbPath)
	) {
		renameSync(legacyDb, config.store.dbPath);
		// Also migrate WAL/SHM files if present
		for (const suffix of ["-wal", "-shm"]) {
			if (existsSync(legacyDb + suffix))
				renameSync(legacyDb + suffix, config.store.dbPath + suffix);
		}
	}

	const kernel = new Kernel(config);

	const shutdown = async () => {
		await kernel.shutdown();
		process.exit(0);
	};
	process.on("SIGINT", shutdown);
	process.on("SIGTERM", shutdown);

	await kernel.boot();

	if (config.web.enabled) {
		console.log(`\n  🌐 Web UI: http://${config.web.host}:${config.web.port}`);
	}
	console.log("\n  🐾 Paw is running. Press Ctrl+C to stop.\n");
}
