import { resolve, relative } from "node:path";
import type { ToolDefinition, ToolResult } from "../types/message.js";

interface ExecToolsConfig {
  workspacePath: string;
  maxOutputLength: number;
  execTimeout: number;
  allowedCommands?: string[];
}

// Shell metacharacters that indicate command chaining/injection
const SHELL_METACHAR_RE = /[;&|`$(){}!<>\n\\]/;

/**
 * Parse a command string into [executable, ...args] without shell interpretation.
 * Supports simple quoting (single and double quotes) but rejects shell metacharacters.
 */
function parseArgv(command: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let inSingle = false;
  let inDouble = false;

  for (let i = 0; i < command.length; i++) {
    const ch = command[i];
    if (inSingle) {
      if (ch === "'") { inSingle = false; continue; }
      current += ch;
    } else if (inDouble) {
      if (ch === '"') { inDouble = false; continue; }
      current += ch;
    } else if (ch === "'") {
      inSingle = true;
    } else if (ch === '"') {
      inDouble = true;
    } else if (/\s/.test(ch)) {
      if (current) { tokens.push(current); current = ""; }
    } else {
      current += ch;
    }
  }
  if (current) tokens.push(current);
  return tokens;
}

export function createExecTools(config: ExecToolsConfig): ToolDefinition[] {
  const execCommand: ToolDefinition = {
    name: "exec_command",
    description: "Execute a command within the workspace. Provide the command and arguments. Shell operators (pipes, redirects, semicolons, &&) are not allowed — use separate tool calls instead.",
    plugin: "kernel",
    input_schema: {
      type: "object",
      properties: {
        command: { type: "string", description: "The command to execute (e.g. 'ls -la src')" },
        cwd: { type: "string", description: "Working directory (relative to workspace, default: workspace root)" },
        timeout_ms: { type: "number", description: `Timeout in ms (default: ${config.execTimeout})` },
      },
      required: ["command"],
    },
    handler: async (input): Promise<ToolResult> => {
      const command = input.command as string;

      // Reject shell metacharacters to prevent injection
      if (SHELL_METACHAR_RE.test(command)) {
        return {
          content: "Error: shell operators (;, &, |, `, $, etc.) are not allowed. Use separate exec_command calls for multiple commands.",
          is_error: true,
        };
      }

      // Parse into argv without shell interpretation
      const argv = parseArgv(command);
      if (argv.length === 0) {
        return { content: "Error: empty command", is_error: true };
      }

      const executable = argv[0];

      // Check allowlist if configured
      if (config.allowedCommands && config.allowedCommands.length > 0) {
        if (!config.allowedCommands.includes(executable)) {
          return { content: `Error: command '${executable}' is not in the allowed list`, is_error: true };
        }
      }

      // Validate cwd is within workspace
      const cwd = input.cwd
        ? resolve(config.workspacePath, input.cwd as string)
        : config.workspacePath;

      const cwdRel = relative(config.workspacePath, cwd);
      if (cwdRel.startsWith("..")) {
        return { content: "Error: working directory must be within the workspace", is_error: true };
      }

      const timeout = typeof input.timeout_ms === "number"
        ? Math.min(input.timeout_ms, config.execTimeout)
        : config.execTimeout;

      try {
        const proc = Bun.spawn(argv, {
          cwd,
          stdout: "pipe",
          stderr: "pipe",
          env: { ...process.env, PATH: process.env.PATH },
        });

        // Set up timeout
        const timeoutId = setTimeout(() => {
          proc.kill();
        }, timeout);

        const [stdout, stderr] = await Promise.all([
          new Response(proc.stdout).text(),
          new Response(proc.stderr).text(),
        ]);
        const exitCode = await proc.exited;
        clearTimeout(timeoutId);

        let output = "";
        if (stdout) output += stdout;
        if (stderr) output += (output ? "\n--- stderr ---\n" : "") + stderr;
        output += `\n[exit code: ${exitCode}]`;

        if (output.length > config.maxOutputLength) {
          output = output.slice(0, config.maxOutputLength) + "\n... (truncated)";
        }

        return { content: output, is_error: exitCode !== 0 };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: `Error executing command: ${message}`, is_error: true };
      }
    },
  };

  return [execCommand];
}
