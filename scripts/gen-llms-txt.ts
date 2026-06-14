#!/usr/bin/env bun
// Write static llms.txt + llms-full.txt to the repo root. The web server also
// serves these dynamically (never drifts), so this script is only needed when a
// static copy is wanted (e.g. committed, or for a static host). Run on build/
// deploy via `bun run gen:llms`.

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { generateLlmsDocs } from "../src/web/llms-docs.js";

const root = process.cwd();
const { index, full } = generateLlmsDocs(root);
writeFileSync(join(root, "llms.txt"), index, "utf-8");
writeFileSync(join(root, "llms-full.txt"), full, "utf-8");
console.log(
	`Wrote llms.txt (${index.length} bytes) + llms-full.txt (${full.length} bytes)`,
);
