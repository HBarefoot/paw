import type { ToolDefinition, ToolResult } from "../types/message.js";

interface ExecToolsConfig {
  workspacePath: string;
  maxOutputLength: number;
  execTimeout: number;
  allowedCommands?: string[];
}

export function createExecTools(config: ExecToolsConfig): ToolDefinition[] {
  const execCommand: ToolDefinition = {
    name: "exec_command",
    description: "Execute a shell command within the workspace. Output is captured and returned.",
    plugin: "kernel",
    input_schema: {
      type: "object",
      properties: {
        command: { type: "string", description: "The shell command to execute" },
        cwd: { type: "string", description: "Working directory (relative to workspace, default: workspace root)" },
        timeout_ms: { type: "number", description: `Timeout in ms (default: ${config.execTimeout})` },
      },
      required: ["command"],
    },
    handler: async (input): Promise<ToolResult> => {
      const command = input.command as string;

      // Check allowlist if configured
      if (config.allowedCommands && config.allowedCommands.length > 0) {
        const baseCmd = command.split(/\s+/)[0];
        if (!config.allowedCommands.includes(baseCmd)) {
          return { content: `Error: command '${baseCmd}' is not in the allowed list`, is_error: true };
        }
      }

      const cwd = input.cwd
        ? Bun.resolveSync(input.cwd as string, config.workspacePath)
        : config.workspacePath;

      const timeout = typeof input.timeout_ms === "number"
        ? Math.min(input.timeout_ms, config.execTimeout)
        : config.execTimeout;

      try {
        const proc = Bun.spawn(["sh", "-c", command], {
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
