import type { Attachment } from "../types/message.js";

let xlsxModule: typeof import("xlsx") | null = null;

async function getXLSX() {
	if (!xlsxModule) xlsxModule = await import("xlsx");
	return xlsxModule;
}

/** Cap extracted text so a huge file can't blow out the model context. */
const MAX_TEXT_CHARS = 200_000;
function clampText(text: string): string {
	return text.length > MAX_TEXT_CHARS
		? `${text.slice(0, MAX_TEXT_CHARS)}\n... (truncated, ${text.length} chars total)`
		: text;
}

/**
 * Plain-text-family extensions read verbatim as UTF-8 — anything text-like the
 * model can use directly (config, code, data, logs). Images go through the
 * separate `images` attachment path; audio/video fall through to the binary
 * badge (they play inline in the browser but the text model can't read them).
 */
const TEXT_EXTS = new Set([
	"txt", "md", "markdown", "json", "jsonl", "ndjson", "tsv", "log", "yaml",
	"yml", "xml", "html", "htm", "css", "scss", "less", "js", "jsx", "ts", "tsx",
	"mjs", "cjs", "py", "rb", "go", "rs", "java", "kt", "swift", "c", "h", "cpp",
	"cc", "hpp", "cs", "php", "sh", "bash", "zsh", "sql", "toml", "ini", "cfg",
	"conf", "env", "properties", "gradle", "r", "lua", "pl", "dart", "vue",
	"svelte", "graphql", "proto", "dockerfile", "makefile", "gitignore",
]);

async function parsePDF(buffer: Buffer): Promise<string> {
	const { extractText } = await import("unpdf");
	const { text } = await extractText(new Uint8Array(buffer), {
		mergePages: true,
	});
	// `text` is a string with mergePages:true; stay defensive if it's an array.
	const t = text as unknown as string | string[];
	return (Array.isArray(t) ? t.join("\n") : t).trim();
}

function isTextLike(ext: string | undefined, mimeType: string): boolean {
	if (ext && TEXT_EXTS.has(ext)) return true;
	return (
		mimeType.startsWith("text/") ||
		mimeType === "application/json" ||
		mimeType === "application/xml" ||
		mimeType.endsWith("+json") ||
		mimeType.endsWith("+xml")
	);
}

export function parseCSV(buffer: Buffer, maxRows = 500): string {
	const text = buffer.toString("utf-8");
	let count = 0,
		lastIdx = 0;
	for (let i = 0; i < text.length; i++) {
		if (text[i] === "\n") {
			count++;
			if (count === maxRows) {
				lastIdx = i;
				break;
			}
		}
	}
	if (count >= maxRows) {
		const totalLines = text.split("\n").length;
		return (
			text.slice(0, lastIdx) +
			"\n... (truncated, " +
			totalLines +
			" total rows)"
		);
	}
	return text;
}

export async function parseExcel(
	buffer: Buffer,
	maxRows = 500,
): Promise<string> {
	const XLSX = await getXLSX();
	const workbook = XLSX.read(buffer, { type: "buffer" });
	const sheets: string[] = [];
	for (const name of workbook.SheetNames) {
		const csv = XLSX.utils.sheet_to_csv(workbook.Sheets[name]);
		const lines = csv.split("\n");
		const truncated =
			lines.length > maxRows
				? lines.slice(0, maxRows).join("\n") + "\n... (truncated)"
				: csv;
		sheets.push(`--- Sheet: ${name} ---\n${truncated}`);
	}
	return sheets.join("\n\n");
}

export async function parseUploadedFiles(
	files: Array<{ data: string; mimeType: string; name: string }>,
): Promise<Attachment[]> {
	const attachments: Attachment[] = [];
	for (const file of files) {
		const buffer = Buffer.from(file.data, "base64");
		const ext = file.name.split(".").pop()?.toLowerCase();
		const mime = file.mimeType || "";
		let textContent = "";

		if (ext === "csv") {
			textContent = parseCSV(buffer);
		} else if (ext === "xlsx" || ext === "xls") {
			try {
				textContent = await parseExcel(buffer);
			} catch {
				textContent = "(Failed to parse Excel file)";
			}
		} else if (ext === "pdf" || mime === "application/pdf") {
			try {
				textContent =
					clampText(await parsePDF(buffer)) ||
					"(PDF had no extractable text — it may be scanned/image-only)";
			} catch {
				textContent = "(Failed to extract text from PDF)";
			}
		} else if (isTextLike(ext, mime)) {
			textContent = clampText(buffer.toString("utf-8"));
		} else {
			// Unknown/binary (incl. audio/video): note it so the model knows a file
			// was attached even though its bytes aren't text the model can read.
			textContent = `[Attached file: ${file.name} (${mime || "binary"}, ${buffer.length} bytes) — binary content not extracted]`;
		}

		if (textContent) {
			attachments.push({
				type: "text",
				data: Buffer.from(textContent, "utf-8"),
				mimeType: "text/plain",
				name: file.name,
			});
		}
	}
	return attachments;
}
