import { getDb, closeDb } from "../../store/db.js";
import { loadConfig } from "../../config/loader.js";
import { resolveProjectPath } from "../../paths.js";
import { EventBus } from "../../kernel/bus.js";
import { ToolRegistry } from "../../ai/tools.js";
import { CronScheduler } from "../../cron/scheduler.js";
import { isValidCron } from "../../cron/parser.js";
import { createLogger } from "../../observability/logger.js";

export async function cronCommand(subcommand: string | undefined, args: string[]): Promise<void> {
  const config = loadConfig();
  const db = getDb(resolveProjectPath(config.store.dbPath), config.store.customSqlitePath);
  const bus = new EventBus();
  const toolRegistry = new ToolRegistry();
  const logger = createLogger("cron-cli");
  const scheduler = new CronScheduler(db, bus, toolRegistry, logger);

  try {
    switch (subcommand) {
      case "list":
        listJobs(scheduler);
        break;
      case "add":
        addJob(scheduler, args);
        break;
      case "remove":
        removeJob(scheduler, args);
        break;
      case "enable":
        toggleJob(scheduler, args[0], true);
        break;
      case "disable":
        toggleJob(scheduler, args[0], false);
        break;
      default:
        printUsage();
    }
  } finally {
    closeDb();
  }
}

function listJobs(scheduler: CronScheduler): void {
  const jobs = scheduler.listJobs();
  if (jobs.length === 0) {
    console.log("\n  No cron jobs configured.\n");
    return;
  }

  console.log(`\n  Cron Jobs (${jobs.length}):\n`);
  for (const job of jobs) {
    const status = job.enabled ? "enabled" : "disabled";
    const lastRun = job.lastRun ? new Date(job.lastRun).toLocaleString() : "never";
    const nextRun = new Date(job.nextRun).toLocaleString();
    console.log(`  ${job.id.slice(0, 8)}  [${status}]  ${job.name}`);
    console.log(`           expr: ${job.expression} (${job.timezone})`);
    console.log(`           type: ${job.action.type}  last: ${lastRun}  next: ${nextRun}`);
    console.log();
  }
}

function addJob(scheduler: CronScheduler, args: string[]): void {
  if (args.length < 3) {
    console.error('\n  Usage: paw cron add <name> <expression> <action-json>\n');
    console.error('  Example: paw cron add "hello" "*/5 * * * *" \'{"type":"prompt","prompt":"say hello"}\'\n');
    return;
  }

  const [name, expression, actionJson] = args;

  if (!isValidCron(expression)) {
    console.error(`\n  Invalid cron expression: ${expression}\n`);
    return;
  }

  let action;
  try {
    action = JSON.parse(actionJson);
  } catch {
    console.error(`\n  Invalid JSON for action: ${actionJson}\n`);
    return;
  }

  const id = scheduler.addJob({ name, expression, action });
  console.log(`\n  Cron job created: ${id}\n`);
}

function removeJob(scheduler: CronScheduler, args: string[]): void {
  if (!args[0]) {
    console.error("\n  Usage: paw cron remove <id>\n");
    return;
  }
  const removed = scheduler.removeJob(args[0]);
  console.log(removed ? `\n  Removed: ${args[0]}\n` : `\n  Job not found: ${args[0]}\n`);
}

function toggleJob(scheduler: CronScheduler, id: string | undefined, enable: boolean): void {
  if (!id) {
    console.error(`\n  Usage: paw cron ${enable ? "enable" : "disable"} <id>\n`);
    return;
  }
  const ok = enable ? scheduler.enableJob(id) : scheduler.disableJob(id);
  console.log(ok ? `\n  ${enable ? "Enabled" : "Disabled"}: ${id}\n` : `\n  Job not found: ${id}\n`);
}

function printUsage(): void {
  console.log(`
  Usage: paw cron <command>

  Commands:
    list                                List all cron jobs
    add <name> <expr> <action-json>     Add a new cron job
    remove <id>                         Remove a cron job
    enable <id>                         Enable a disabled job
    disable <id>                        Disable a job
`);
}
