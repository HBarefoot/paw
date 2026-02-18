import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import {
  loadCredentials,
  saveCredentials,
  getCredentialsPath,
  readClaudeToken,
  type StoredCredentials,
} from "../../auth/credential-store.js";
import { promptChoice, promptText, promptSecret, promptConfirm, closePrompt } from "../../auth/prompt.js";
import { readConfigOverrides, saveConfigOverrides } from "../../config/writer.js";
import { defaults } from "../../config/defaults.js";

export async function initCommand(): Promise<void> {
  console.log("\n  🐾 Paw Setup Wizard\n");
  console.log("  Credentials are stored securely in ~/.paw/credentials.json");
  console.log("  (chmod 600 — only your user can read them)\n");

  const creds = loadCredentials();

  try {
    // Step 1: Choose AI provider
    const provider = await chooseProvider(creds);

    // Reset ai.model in config.json when provider changes so stale models
    // from a previous provider don't bleed through (e.g. Ollama model → Claude).
    const overrides = readConfigOverrides();
    if (overrides.ai && typeof overrides.ai === "object" && "model" in overrides.ai) {
      const providerDefaults: Record<string, string> = {
        claude: defaults.ai.model,
        ollama: defaults.ollama.model,
        openai: defaults.openai.model,
        gemini: defaults.gemini.model,
      };
      (overrides.ai as Record<string, unknown>).model = providerDefaults[provider];
      saveConfigOverrides(overrides);
    }

    // Step 2: Provider-specific setup
    if (provider === "ollama") {
      await setupOllama(creds);
    } else if (provider === "openai") {
      await setupOpenAI(creds);
    } else if (provider === "gemini") {
      await setupGemini(creds);
    } else {
      await setupAnthropic(creds);
    }

    // Step 3: Slack (optional)
    await setupSlack(creds);

    // Step 4: Ensure data dir exists
    mkdirSync(resolve("data"), { recursive: true });

    saveCredentials(creds);

    console.log(`\n  ✓ Credentials saved to ${getCredentialsPath()}`);
    console.log("\n  Run: paw start\n");
  } finally {
    closePrompt();
  }
}

async function chooseProvider(creds: StoredCredentials): Promise<"claude" | "ollama" | "openai" | "gemini"> {
  const choice = await promptChoice("Which AI provider do you want to use?", [
    "Claude by Anthropic (Max/Pro subscription or API key)",
    "OpenAI (GPT-4o, o1, etc.)",
    "Google Gemini (Gemini 2.0 Flash, Pro, etc.)",
    "Ollama (free, runs locally or on your network)",
  ]);

  const providers: Array<"claude" | "openai" | "gemini" | "ollama"> = ["claude", "openai", "gemini", "ollama"];
  const provider = providers[choice];
  creds.provider = provider;
  return provider;
}

async function setupOllama(creds: StoredCredentials): Promise<void> {
  console.log("\n  Ollama connects to a local or network Ollama instance.\n");

  const baseUrl = await promptText("Ollama URL (default: http://localhost:11434):");
  creds.ollama = {
    baseUrl: baseUrl || "http://localhost:11434",
    model: "",
  };

  const model = await promptText("Model name (default: llama3.1):");
  creds.ollama.model = model || "llama3.1";

  // Quick health check
  const url = creds.ollama.baseUrl.replace(/\/$/, "");
  try {
    const res = await fetch(`${url}/api/tags`);
    if (res.ok) {
      const data = (await res.json()) as { models?: Array<{ name: string }> };
      const models = data.models?.map((m: { name: string }) => m.name) ?? [];
      if (models.length > 0) {
        console.log(`  ✓ Connected to Ollama. Available models: ${models.join(", ")}`);
        const hasModel = models.some((m: string) => m.startsWith(creds.ollama!.model));
        if (!hasModel) {
          console.log(`  ⚠ Model "${creds.ollama.model}" not found. You may need to pull it: ollama pull ${creds.ollama.model}`);
        }
      } else {
        console.log("  ✓ Connected to Ollama (no models pulled yet)");
        console.log(`  Run: ollama pull ${creds.ollama.model}`);
      }
    } else {
      console.log(`  ⚠ Ollama responded with HTTP ${res.status}. Check your URL.`);
    }
  } catch {
    console.log(`  ⚠ Could not reach Ollama at ${url}. Make sure it's running.`);
  }

  console.log("  ✓ Ollama configured");
}

async function setupOpenAI(creds: StoredCredentials): Promise<void> {
  console.log("\n  OpenAI requires an API key from https://platform.openai.com/api-keys\n");

  try {
    const { spawn } = await import("node:child_process");
    const openCmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
    spawn(openCmd, ["https://platform.openai.com/api-keys"], { stdio: "ignore", detached: true }).unref();
    console.log("  (Opened in your browser)\n");
  } catch {}

  const apiKey = await promptSecret("Paste your OpenAI API key (sk-...):");
  if (!apiKey) {
    console.log("  ⚠ No API key entered. Set it later with: OPENAI_API_KEY env var");
    creds.openai = { apiKey: "" };
    return;
  }

  const model = await promptText("Model name (default: gpt-4o):");

  const wantCustomBase = await promptConfirm("Use a custom base URL? (for Azure, Together, etc.)", false);
  let baseUrl: string | undefined;
  if (wantCustomBase) {
    baseUrl = await promptText("Base URL (default: https://api.openai.com/v1):");
  }

  creds.openai = {
    apiKey,
    model: model || undefined,
    baseUrl: baseUrl || undefined,
  };
  console.log("  ✓ OpenAI configured");
}

async function setupGemini(creds: StoredCredentials): Promise<void> {
  console.log("\n  Google Gemini requires an API key from https://aistudio.google.com/apikey\n");

  try {
    const { spawn } = await import("node:child_process");
    const openCmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
    spawn(openCmd, ["https://aistudio.google.com/apikey"], { stdio: "ignore", detached: true }).unref();
    console.log("  (Opened in your browser)\n");
  } catch {}

  const apiKey = await promptSecret("Paste your Gemini API key:");
  if (!apiKey) {
    console.log("  ⚠ No API key entered. Set it later with: GEMINI_API_KEY env var");
    creds.gemini = { apiKey: "" };
    return;
  }

  const model = await promptText("Model name (default: gemini-2.0-flash):");

  creds.gemini = {
    apiKey,
    model: model || undefined,
  };
  console.log("  ✓ Gemini configured");
}

async function setupAnthropic(creds: StoredCredentials): Promise<void> {
  if (creds.anthropic?.apiKey || creds.anthropic?.accessToken) {
    const method = creds.anthropic.method === "oauth" ? "Max/Pro subscription (OAuth)" : "API key";
    console.log(`  Anthropic: Already configured (${method})`);
    const reconfigure = await promptConfirm("Reconfigure?", false);
    if (!reconfigure) return;
  }

  // Auto-detect existing Claude CLI token
  const existingToken = readClaudeToken();
  if (existingToken) {
    console.log("  Found existing Claude CLI token from `claude setup-token`.");
    const useIt = await promptConfirm("Use your Max/Pro subscription?", true);
    if (useIt) {
      creds.anthropic = {
        method: "oauth",
        accessToken: existingToken.accessToken,
        refreshToken: existingToken.refreshToken,
        expiresAt: existingToken.expiresAt ? new Date(existingToken.expiresAt).toISOString() : undefined,
      };
      console.log("  ✓ OAuth token imported from Claude CLI");
      return;
    }
  }

  const choice = await promptChoice("How do you want to authenticate with Claude?", [
    "Use Claude Max/Pro subscription (recommended)",
    "Use an API key (pay-per-use)",
  ]);

  if (choice === 0) {
    await setupOAuth(creds);
  } else {
    await promptApiKey(creds);
  }
}

async function setupOAuth(creds: StoredCredentials): Promise<void> {
  console.log("\n  Run this command in another terminal:\n");
  console.log("    claude setup-token\n");
  console.log("  It will open your browser to sign in with your Anthropic account.");
  console.log("  Come back here when it's done.\n");
  console.log("  Or paste your OAuth token directly:\n");

  const input = await promptText("Token or Enter when ready:");

  // If user pasted a token directly, use it
  if (input && input.startsWith("sk-ant-")) {
    creds.anthropic = { method: "oauth", accessToken: input };
    console.log("  ✓ OAuth token saved");
    return;
  }

  // Otherwise try to read from Claude CLI credentials file
  const token = readClaudeToken();
  if (token) {
    creds.anthropic = {
      method: "oauth",
      accessToken: token.accessToken,
      refreshToken: token.refreshToken,
      expiresAt: token.expiresAt ? new Date(token.expiresAt).toISOString() : undefined,
    };
    console.log("  ✓ OAuth token imported from Claude CLI");
  } else {
    console.log("  ✗ No token found at ~/.claude/.credentials.json");
    console.log("  Make sure `claude setup-token` completed successfully.\n");
    const fallback = await promptConfirm("Fall back to API key?", true);
    if (fallback) {
      await promptApiKey(creds);
    }
  }
}

async function promptApiKey(creds: StoredCredentials): Promise<void> {
  console.log("\n  Get your API key from: https://console.anthropic.com/settings/keys\n");

  try {
    const { spawn } = await import("node:child_process");
    const openCmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
    spawn(openCmd, ["https://console.anthropic.com/settings/keys"], { stdio: "ignore", detached: true }).unref();
    console.log("  (Opened in your browser)\n");
  } catch {}

  const key = await promptSecret("Paste your API key (sk-ant-...):");

  if (!key) {
    console.log("  ⚠ No API key entered. Set it later with: paw auth login");
    return;
  }

  creds.anthropic = { method: "api_key", apiKey: key };
  console.log("  ✓ API key saved");
}

async function setupSlack(creds: StoredCredentials): Promise<void> {
  console.log();
  if (creds.slack?.botToken) {
    console.log("  Slack: Already configured");
    const reconfigure = await promptConfirm("Reconfigure Slack?", false);
    if (!reconfigure) return;
  }

  const wantSlack = await promptConfirm("Set up Slack integration?", true);
  if (!wantSlack) {
    console.log("  Skipping Slack. Set it up later with: paw auth login");
    return;
  }

  console.log("\n  You'll need a Slack app with Socket Mode enabled.");
  console.log("  Create one at: https://api.slack.com/apps\n");

  const botToken = await promptSecret("Bot Token (xoxb-...):");
  const appToken = await promptSecret("App Token (xapp-...):");
  const signingSecret = await promptSecret("Signing Secret:");

  if (!botToken || !appToken) {
    console.log("  ⚠ Missing tokens. Slack will be skipped at runtime.");
    return;
  }

  creds.slack = { botToken, appToken, signingSecret: signingSecret || "" };
  console.log("  ✓ Slack credentials saved");
}
