import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { configSchema } from "./schema.js";

const CONFIG_DIR = join(homedir(), ".paw");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

export function getConfigOverridesPath(): string {
  return CONFIG_FILE;
}

export function readConfigOverrides(): Record<string, unknown> {
  if (!existsSync(CONFIG_FILE)) return {};
  try {
    return JSON.parse(readFileSync(CONFIG_FILE, "utf-8"));
  } catch {
    return {};
  }
}

export function saveConfigOverrides(overrides: Record<string, unknown>): void {
  // Validate the overrides are valid partial config by parsing with defaults
  // We don't do a full parse here since overrides are partial
  const existing = readConfigOverrides();
  const merged = deepMergeOverrides(existing, overrides);

  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_FILE, JSON.stringify(merged, null, 2), "utf-8");
}

function deepMergeOverrides(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    const sv = source[key];
    const tv = target[key];
    if (
      sv !== undefined &&
      sv !== null &&
      typeof sv === "object" &&
      !Array.isArray(sv) &&
      typeof tv === "object" &&
      tv !== null
    ) {
      result[key] = deepMergeOverrides(
        tv as Record<string, unknown>,
        sv as Record<string, unknown>,
      );
    } else if (sv !== undefined) {
      result[key] = sv;
    }
  }
  return result;
}
