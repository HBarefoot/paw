#!/usr/bin/env bun

const command = process.argv[2];
const subcommand = process.argv[3];

const USAGE = `
  🐾 Paw - Personal AI Assistant

  Usage: paw <command>

  Commands:
    start          Start the Paw kernel and all plugins
    init           Interactive setup wizard (credentials + config)
    auth login     Sign in with Anthropic account or API key
    auth logout    Clear stored credentials
    auth status    Show current authentication status
    auth web       Create a web UI admin account
    config         Show current configuration
    status         Check plugin health status
    cron list      List all cron jobs
    cron add       Add a new cron job
    cron remove    Remove a cron job

  First time? Run: paw init

`;

async function main(): Promise<void> {
  switch (command) {
    case "start": {
      const { startCommand } = await import("../src/cli/commands/start.js");
      await startCommand();
      break;
    }
    case "init": {
      const { initCommand } = await import("../src/cli/commands/init.js");
      await initCommand();
      break;
    }
    case "auth": {
      if (subcommand === "web") {
        const { webAuthCommand } = await import("../src/cli/commands/web-auth.js");
        await webAuthCommand();
      } else {
        const { authCommand } = await import("../src/cli/commands/auth.js");
        await authCommand(subcommand);
      }
      break;
    }
    case "config": {
      const { configCommand } = await import("../src/cli/commands/config.js");
      await configCommand();
      break;
    }
    case "status": {
      const { statusCommand } = await import("../src/cli/commands/status.js");
      await statusCommand();
      break;
    }
    case "cron": {
      const { cronCommand } = await import("../src/cli/commands/cron.js");
      const args = process.argv.slice(4);
      await cronCommand(subcommand, args);
      break;
    }
    default:
      console.log(USAGE);
      break;
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
