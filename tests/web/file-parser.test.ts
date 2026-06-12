import { describe, expect, test } from "bun:test";
import { parseUploadedFiles } from "../../src/web/file-parser.js";

function b64(s: string): string {
	return Buffer.from(s, "latin1").toString("base64");
}
function b64utf8(s: string): string {
	return Buffer.from(s, "utf-8").toString("base64");
}

// A minimal one-page PDF whose content stream draws the text "Hello PDF".
const MINIMAL_PDF =
	"%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n" +
	"2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n" +
	"3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 144]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n" +
	"4 0 obj<</Length 44>>stream\nBT /F1 24 Tf 20 100 Td (Hello PDF) Tj ET\nendstream endobj\n" +
	"5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF";

const text = (a: { data?: Buffer }) => a.data?.toString("utf-8") ?? "";

describe("parseUploadedFiles", () => {
	test("extracts text from a PDF", async () => {
		const out = await parseUploadedFiles([
			{ name: "doc.pdf", mimeType: "application/pdf", data: b64(MINIMAL_PDF) },
		]);
		expect(out.length).toBe(1);
		expect(out[0].type).toBe("text");
		expect(text(out[0])).toContain("Hello PDF");
	});

	test("reads plain-text-family files verbatim (json, md, code)", async () => {
		const out = await parseUploadedFiles([
			{ name: "data.json", mimeType: "application/json", data: b64utf8('{"a":1}') },
			{ name: "notes.md", mimeType: "", data: b64utf8("# Title\nbody") },
			{ name: "app.ts", mimeType: "", data: b64utf8("export const x = 1;") },
		]);
		expect(text(out[0])).toBe('{"a":1}');
		expect(text(out[1])).toContain("# Title");
		expect(text(out[2])).toContain("export const x = 1;");
	});

	test("text-like by mime when the extension is unknown", async () => {
		const out = await parseUploadedFiles([
			{ name: "weird.fixture", mimeType: "text/plain", data: b64utf8("hi there") },
		]);
		expect(text(out[0])).toBe("hi there");
	});

	test("unknown/binary (incl. audio/video) → a file badge, not a crash", async () => {
		const out = await parseUploadedFiles([
			{ name: "clip.mp4", mimeType: "video/mp4", data: b64("\x00\x01\x02binary") },
		]);
		expect(out.length).toBe(1);
		expect(text(out[0])).toContain("[Attached file: clip.mp4");
		expect(text(out[0])).toContain("video/mp4");
		expect(text(out[0])).toContain("not extracted");
	});

	test("CSV still parses (unchanged behavior)", async () => {
		const out = await parseUploadedFiles([
			{ name: "rows.csv", mimeType: "text/csv", data: b64utf8("a,b\n1,2\n3,4") },
		]);
		expect(text(out[0])).toContain("a,b");
		expect(text(out[0])).toContain("3,4");
	});

	test("a corrupt PDF fails gracefully (no throw)", async () => {
		const out = await parseUploadedFiles([
			{ name: "bad.pdf", mimeType: "application/pdf", data: b64utf8("not a pdf") },
		]);
		expect(out.length).toBe(1);
		expect(text(out[0]).toLowerCase()).toMatch(/pdf/);
	});
});
