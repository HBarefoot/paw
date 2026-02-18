import { resolve, relative } from "node:path";
import { existsSync, statSync, readdirSync, mkdirSync } from "node:fs";
import type { ToolDefinition, ToolResult } from "../types/message.js";

interface CanvasToolsConfig {
  canvasRoot: string;
}

function isWithinCanvas(filePath: string, root: string): boolean {
  const resolved = resolve(root, filePath);
  const rel = relative(root, resolved);
  return !rel.startsWith("..") && !resolve(resolved).includes("\0");
}

function safePath(filePath: string, root: string): string | null {
  const resolved = resolve(root, filePath);
  if (!isWithinCanvas(filePath, root)) return null;
  return resolved;
}

export function createCanvasTools(config: CanvasToolsConfig): ToolDefinition[] {
  const root = resolve(config.canvasRoot);

  const canvasWrite: ToolDefinition = {
    name: "canvas_write",
    description: "Write a file to the canvas workspace. Creates parent directories automatically. Use this to create HTML, CSS, and JS files for the live preview.",
    plugin: "canvas",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path relative to canvas root (e.g. 'index.html', 'css/style.css')" },
        content: { type: "string", description: "File content to write" },
      },
      required: ["path", "content"],
    },
    handler: async (input): Promise<ToolResult> => {
      const filePath = safePath(input.path as string, root);
      if (!filePath) return { content: "Error: path is outside canvas root", is_error: true };

      const content = input.content as string;

      // Create parent directories
      const dir = resolve(filePath, "..");
      mkdirSync(dir, { recursive: true });

      await Bun.write(filePath, content);
      return { content: JSON.stringify({ written: true, path: input.path }) };
    },
  };

  const canvasRead: ToolDefinition = {
    name: "canvas_read",
    description: "Read a file from the canvas workspace.",
    plugin: "canvas",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path relative to canvas root" },
      },
      required: ["path"],
    },
    handler: async (input): Promise<ToolResult> => {
      const filePath = safePath(input.path as string, root);
      if (!filePath) return { content: "Error: path is outside canvas root", is_error: true };

      if (!existsSync(filePath)) return { content: `Error: file not found: ${input.path}`, is_error: true };

      const stat = statSync(filePath);
      if (stat.isDirectory()) return { content: "Error: path is a directory, use canvas_list instead", is_error: true };

      const file = Bun.file(filePath);
      return { content: await file.text() };
    },
  };

  const canvasList: ToolDefinition = {
    name: "canvas_list",
    description: "List files in the canvas workspace with sizes.",
    plugin: "canvas",
    input_schema: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Glob-style pattern to filter (e.g. '*.html')" },
      },
    },
    handler: async (input): Promise<ToolResult> => {
      if (!existsSync(root)) return { content: "(empty canvas)" };

      const entries: string[] = [];
      const pattern = input.pattern as string | undefined;
      const regex = pattern ? new RegExp(pattern.replace(/\*/g, ".*").replace(/\?/g, ".")) : null;

      function walk(dir: string, depth: number): void {
        if (entries.length >= 500 || depth > 10) return;
        const items = readdirSync(dir, { withFileTypes: true });
        for (const item of items) {
          if (item.name.startsWith(".")) continue;
          const fullPath = resolve(dir, item.name);
          const rel = relative(root, fullPath);
          if (regex && !regex.test(item.name)) continue;
          if (item.isDirectory()) {
            entries.push(`${rel}/`);
            walk(fullPath, depth + 1);
          } else {
            const size = statSync(fullPath).size;
            entries.push(`${rel} (${size}b)`);
          }
        }
      }

      walk(root, 0);
      return { content: entries.join("\n") || "(empty canvas)" };
    },
  };

  return [canvasWrite, canvasRead, canvasList];
}
