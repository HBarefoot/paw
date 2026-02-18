import { readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { existsSync } from "node:fs";
import type { ChannelPlugin } from "../types/plugin.js";
import type { PluginManifest } from "../types/permissions.js";
import type { Logger } from "../types/plugin.js";

export interface LoadedPlugin {
  plugin: ChannelPlugin;
  manifest: PluginManifest;
}

export async function discoverPlugins(pluginsDir: string, logger: Logger): Promise<LoadedPlugin[]> {
  const absDir = resolve(pluginsDir);
  if (!existsSync(absDir)) {
    logger.warn("Plugins directory not found", { dir: absDir });
    return [];
  }

  const entries = await readdir(absDir, { withFileTypes: true });
  const plugins: LoadedPlugin[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const pluginDir = join(absDir, entry.name);
    const indexPath = join(pluginDir, "index.ts");
    const manifestPath = join(pluginDir, "manifest.json");

    if (!existsSync(indexPath)) {
      logger.warn("Plugin missing index.ts", { dir: entry.name });
      continue;
    }

    try {
      const mod = await import(indexPath);
      const PluginClass = mod.default || mod[Object.keys(mod)[0]];
      const plugin: ChannelPlugin = new PluginClass();

      let manifest: PluginManifest = {
        name: plugin.name,
        version: "0.0.0",
        description: "",
        permissions: [],
      };

      if (existsSync(manifestPath)) {
        const file = Bun.file(manifestPath);
        manifest = { ...manifest, ...JSON.parse(await file.text()) };
      }

      plugins.push({ plugin, manifest });
      logger.info("Discovered plugin", { name: plugin.name });
    } catch (err) {
      logger.error("Failed to load plugin", { dir: entry.name, error: String(err) });
    }
  }

  return plugins;
}
