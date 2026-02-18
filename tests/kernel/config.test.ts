import { describe, test, expect } from "bun:test";
import { loadConfig } from "../../src/config/loader.js";

describe("Config Loader", () => {
  test("loads defaults when no env vars set", () => {
    const config = loadConfig({ ai: { apiKey: "test-key", authMethod: "api_key", model: "claude-sonnet-4-5-20250929", maxTokens: 4096, maxToolRoundtrips: 10 } });
    expect(config.ai.model).toBe("claude-sonnet-4-5-20250929");
    expect(config.ai.maxTokens).toBe(4096);
    expect(config.ai.authMethod).toBe("api_key");
    expect(config.webPilot.headless).toBe(true);
    expect(config.log.level).toBe("info");
  });

  test("overrides merge correctly", () => {
    const config = loadConfig({
      ai: { apiKey: "test-key", authMethod: "oauth", model: "claude-opus-4-6", maxTokens: 8192, maxToolRoundtrips: 10 },
      log: { level: "debug" },
    });
    expect(config.ai.model).toBe("claude-opus-4-6");
    expect(config.ai.maxTokens).toBe(8192);
    expect(config.ai.authMethod).toBe("oauth");
    expect(config.log.level).toBe("debug");
  });

  test("allows oauth authMethod", () => {
    const config = loadConfig({ ai: { apiKey: "", authMethod: "oauth", model: "claude-sonnet-4-5-20250929", maxTokens: 4096, maxToolRoundtrips: 10 } });
    expect(config.ai.authMethod).toBe("oauth");
    expect(typeof config.ai.apiKey).toBe("string");
  });
});
