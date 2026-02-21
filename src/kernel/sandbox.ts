import type { PluginManifest } from "../types/permissions.js";
import type { Logger } from "../types/plugin.js";

export class Sandbox {
	private manifests = new Map<string, PluginManifest>();
	private logger: Logger;

	constructor(logger: Logger) {
		this.logger = logger;
	}

	registerManifest(manifest: PluginManifest): void {
		this.manifests.set(manifest.name, manifest);
		this.logger.info("Registered plugin manifest", {
			plugin: manifest.name,
			permissions: manifest.permissions,
		});
	}

	checkPermission(pluginName: string, permission: string): boolean {
		const manifest = this.manifests.get(pluginName);
		if (!manifest) {
			this.logger.warn("No manifest for plugin", { plugin: pluginName });
			return false;
		}

		for (const granted of manifest.permissions) {
			if (granted === permission) return true;

			// Wildcard match: "net:*.slack.com" matches "net:api.slack.com"
			if (granted.includes("*")) {
				const pattern = granted.replace(/\*/g, ".*");
				if (new RegExp(`^${pattern}$`).test(permission)) return true;
			}
		}

		this.logger.warn("Permission denied", { plugin: pluginName, permission });
		return false;
	}

	getManifest(pluginName: string): PluginManifest | undefined {
		return this.manifests.get(pluginName);
	}
}
