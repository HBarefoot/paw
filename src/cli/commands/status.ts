import { Kernel } from "../../kernel/kernel.js";
import { loadConfig } from "../../config/loader.js";

export async function statusCommand(): Promise<void> {
  console.log("\n  🐾 Paw Status\n");

  try {
    const config = loadConfig();
    const kernel = new Kernel(config);
    await kernel.boot();

    const health = await kernel.healthCheck();
    for (const [name, result] of Object.entries(health)) {
      const icon = result.ok ? "✓" : "✗";
      console.log(`  ${icon} ${name}: ${result.details ?? (result.ok ? "healthy" : "unhealthy")}`);
    }

    await kernel.shutdown();
  } catch (err) {
    console.error("  Failed to check status:", err);
  }
  console.log();
}
