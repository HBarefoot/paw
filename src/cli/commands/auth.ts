import {
  loadCredentials,
  saveCredentials,
  clearCredentials,
  getCredentialsPath,
  readClaudeToken,
  type StoredCredentials,
} from "../../auth/credential-store.js";
import { promptChoice, promptText, promptSecret, promptConfirm, closePrompt } from "../../auth/prompt.js";

export async function authCommand(subcommand?: string): Promise<void> {
  switch (subcommand) {
    case "login":
      await authLogin();
      break;
    case "logout":
      await authLogout();
      break;
    case "status":
      authStatus();
      break;
    default:
      console.log(`
  Usage: paw auth <command>

  Commands:
    login     Authenticate with an AI provider or Slack
    logout    Clear stored credentials
    status    Show current authentication status
`);
  }
}

async function authLogin(): Promise<void> {
  console.log("\n  🐾 Paw Authentication\n");
  const creds = loadCredentials();

  try {
    const choice = await promptChoice("What do you want to configure?", [
      "Anthropic (Claude AI)",
      "OpenAI (GPT-4o, o1, etc.)",
      "Google Gemini",
      "Slack",
    ]);

    if (choice === 0) {
      await loginAnthropic(creds);
    } else if (choice === 1) {
      await loginOpenAI(creds);
    } else if (choice === 2) {
      await loginGemini(creds);
    } else if (choice === 3) {
      await loginSlack(creds);
    }

    saveCredentials(creds);
    console.log(`\n  ✓ Credentials saved to ${getCredentialsPath()}\n`);
  } finally {
    closePrompt();
  }
}

async function loginAnthropic(creds: StoredCredentials): Promise<void> {
  // Auto-detect existing Claude CLI token
  const existingToken = readClaudeToken();
  if (existingToken) {
    console.log("\n  Found existing Claude CLI token from `claude setup-token`.");
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

  const method = await promptChoice("How do you want to authenticate with Claude?", [
    "Use Claude Max/Pro subscription (recommended)",
    "Use an API key (pay-per-use)",
  ]);

  if (method === 0) {
    console.log("\n  Run this command in another terminal:\n");
    console.log("    claude setup-token\n");
    console.log("  It will open your browser to sign in with your Anthropic account.");
    console.log("  Come back here when it's done.\n");
    console.log("  Or paste your OAuth token directly:\n");

    const input = await promptText("Token or Enter when ready:");

    if (input && input.startsWith("sk-ant-")) {
      creds.anthropic = { method: "oauth", accessToken: input };
      console.log("  ✓ OAuth token saved");
    } else {
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
        console.log("  ✗ No token found. Make sure `claude setup-token` completed successfully.");
      }
    }
  } else {
    console.log("\n  Get your API key from: https://console.anthropic.com/settings/keys\n");
    try {
      const { spawn } = await import("node:child_process");
      const openCmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
      spawn(openCmd, ["https://console.anthropic.com/settings/keys"], { stdio: "ignore", detached: true }).unref();
      console.log("  (Opened in your browser)\n");
    } catch {}

    const key = await promptSecret("Paste your API key (sk-ant-...):");
    if (key) {
      creds.anthropic = { method: "api_key", apiKey: key };
      console.log("  ✓ API key saved");
    }
  }
}

async function loginOpenAI(creds: StoredCredentials): Promise<void> {
  console.log("\n  Get your API key from: https://platform.openai.com/api-keys\n");

  try {
    const { spawn } = await import("node:child_process");
    const openCmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
    spawn(openCmd, ["https://platform.openai.com/api-keys"], { stdio: "ignore", detached: true }).unref();
    console.log("  (Opened in your browser)\n");
  } catch {}

  const apiKey = await promptSecret("Paste your OpenAI API key (sk-...):");
  if (!apiKey) {
    console.log("  ⚠ No API key entered.");
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
  console.log("  ✓ OpenAI credentials saved");
}

async function loginGemini(creds: StoredCredentials): Promise<void> {
  console.log("\n  Get your API key from: https://aistudio.google.com/apikey\n");

  try {
    const { spawn } = await import("node:child_process");
    const openCmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
    spawn(openCmd, ["https://aistudio.google.com/apikey"], { stdio: "ignore", detached: true }).unref();
    console.log("  (Opened in your browser)\n");
  } catch {}

  const apiKey = await promptSecret("Paste your Gemini API key:");
  if (!apiKey) {
    console.log("  ⚠ No API key entered.");
    return;
  }

  const model = await promptText("Model name (default: gemini-2.0-flash):");

  creds.gemini = {
    apiKey,
    model: model || undefined,
  };
  console.log("  ✓ Gemini credentials saved");
}

async function loginSlack(creds: StoredCredentials): Promise<void> {
  console.log("\n  You'll need a Slack app with Socket Mode enabled.");
  console.log("  Create one at: https://api.slack.com/apps\n");

  const botToken = await promptSecret("Bot Token (xoxb-...):");
  const appToken = await promptSecret("App Token (xapp-...):");
  const signingSecret = await promptSecret("Signing Secret:");

  if (botToken && appToken) {
    creds.slack = { botToken, appToken, signingSecret: signingSecret || "" };
    console.log("  ✓ Slack credentials saved");
  } else {
    console.log("  ⚠ Missing required tokens, Slack not configured.");
  }
}

async function authLogout(): Promise<void> {
  console.log("\n  🐾 Paw Logout\n");

  try {
    const choice = await promptChoice("What do you want to clear?", [
      "Anthropic credentials",
      "OpenAI credentials",
      "Gemini credentials",
      "Slack credentials",
      "Everything",
    ]);

    const targets = ["anthropic", "openai", "gemini", "slack", undefined] as const;
    const target = targets[choice];

    if (target === undefined) {
      clearCredentials();
      console.log("  ✓ All credentials cleared");
    } else {
      // clearCredentials only supports "anthropic" | "slack" currently
      // For openai/gemini, manually remove from stored creds
      if (target === "anthropic" || target === "slack") {
        clearCredentials(target);
      } else {
        const creds = loadCredentials();
        delete (creds as Record<string, unknown>)[target];
        saveCredentials(creds);
      }
      console.log(`  ✓ ${target.charAt(0).toUpperCase() + target.slice(1)} credentials cleared`);
    }
    console.log();
  } finally {
    closePrompt();
  }
}

function authStatus(): void {
  console.log("\n  🐾 Paw Auth Status\n");

  const creds = loadCredentials();
  const claudeToken = readClaudeToken();

  // Provider
  const provider = creds.provider ?? "claude";
  console.log(`  Provider:  ${provider}`);

  // Anthropic
  if (creds.anthropic?.method === "oauth" && creds.anthropic.accessToken) {
    console.log("  Anthropic: ✓ Max/Pro subscription (OAuth)");
  } else if (creds.anthropic?.method === "api_key" && creds.anthropic.apiKey) {
    const k = creds.anthropic.apiKey;
    const masked = k.slice(0, 10) + "..." + k.slice(-4);
    console.log(`  Anthropic: ✓ API key (${masked})`);
  } else if (process.env.ANTHROPIC_API_KEY) {
    console.log("  Anthropic: ✓ Using ANTHROPIC_API_KEY env var");
  } else if (claudeToken) {
    console.log("  Anthropic: ✓ Claude CLI token detected (run `paw init` to import)");
  } else {
    console.log("  Anthropic: - Not configured");
  }

  // OpenAI
  if (creds.openai?.apiKey) {
    const k = creds.openai.apiKey;
    const masked = k.slice(0, 7) + "..." + k.slice(-4);
    const model = creds.openai.model ?? "gpt-4o";
    console.log(`  OpenAI:    ✓ API key (${masked}), model: ${model}`);
  } else if (process.env.OPENAI_API_KEY) {
    console.log("  OpenAI:    ✓ Using OPENAI_API_KEY env var");
  } else {
    console.log("  OpenAI:    - Not configured");
  }

  // Gemini
  if (creds.gemini?.apiKey) {
    const k = creds.gemini.apiKey;
    const masked = k.slice(0, 7) + "..." + k.slice(-4);
    const model = creds.gemini.model ?? "gemini-2.0-flash";
    console.log(`  Gemini:    ✓ API key (${masked}), model: ${model}`);
  } else if (process.env.GEMINI_API_KEY) {
    console.log("  Gemini:    ✓ Using GEMINI_API_KEY env var");
  } else {
    console.log("  Gemini:    - Not configured");
  }

  // Ollama
  if (provider === "ollama") {
    if (creds.ollama?.baseUrl) {
      console.log(`  Ollama:    ✓ ${creds.ollama.model} @ ${creds.ollama.baseUrl}`);
    } else if (process.env.PAW_OLLAMA_BASE_URL) {
      console.log("  Ollama:    ✓ Using env vars");
    } else {
      console.log("  Ollama:    - Not configured");
    }
  }

  // Slack
  if (creds.slack?.botToken) {
    console.log("  Slack:     ✓ Configured");
  } else if (process.env.SLACK_BOT_TOKEN) {
    console.log("  Slack:     ✓ Using env vars");
  } else {
    console.log("  Slack:     - Not configured (optional)");
  }

  console.log(`\n  Credentials: ${getCredentialsPath()}\n`);
}
