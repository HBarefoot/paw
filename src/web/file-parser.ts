import type { Attachment } from "../types/message.js";

let xlsxModule: typeof import("xlsx") | null = null;

async function getXLSX() {
	if (!xlsxModule) xlsxModule = await import("xlsx");
	return xlsxModule;
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
		let textContent = "";

		if (ext === "csv") {
			textContent = parseCSV(buffer);
		} else if (ext === "xlsx" || ext === "xls") {
			try {
				textContent = await parseExcel(buffer);
			} catch {
				textContent = "(Failed to parse Excel file)";
			}
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
