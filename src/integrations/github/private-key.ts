import { createPrivateKey } from "node:crypto";

/**
 * Repair a GitHub App private key that may have been mangled on paste, and
 * normalize it to a canonical PKCS#8 PEM (the format the App JWT signer needs).
 *
 * Handles the common failure modes:
 * - newlines stripped (multi-line PEM pasted into a single-line field) → the
 *   base64 body is re-wrapped at 64 chars,
 * - literal `\n` escape sequences → un-escaped,
 * - PKCS#1 (`BEGIN RSA PRIVATE KEY`, GitHub's download format) → converted to
 *   PKCS#8,
 * - bare base64 body with no PEM header → wrapped and tried as both PKCS#8 and
 *   PKCS#1.
 *
 * Returns the input unchanged if it can't be parsed, so callers can surface a
 * clear auth error. Use `isValidPrivateKey()` to check validity.
 */
export function normalizePrivateKey(raw: string): string {
	let key = (raw ?? "").trim();
	if (!key) return key;
	if (key.includes("\\n")) key = key.replace(/\\n/g, "\n");

	const m = key.match(
		/-----BEGIN ([A-Z0-9 ]+?)-----([\s\S]*?)-----END \1-----/,
	);
	if (m) {
		const label = m[1].trim();
		const body = (m[2] || "").replace(/[^A-Za-z0-9+/=]/g, "");
		const wrapped = body.match(/.{1,64}/g)?.join("\n") ?? body;
		const rebuilt = `-----BEGIN ${label}-----\n${wrapped}\n-----END ${label}-----\n`;
		const out = tryExport(rebuilt);
		return out ?? rebuilt;
	}

	// No recognizable PEM header. If it's a bare base64 body, try wrapping it as
	// PKCS#8 then PKCS#1.
	const body = key.replace(/[^A-Za-z0-9+/=]/g, "");
	if (body.length > 100) {
		const wrapped = body.match(/.{1,64}/g)?.join("\n") ?? body;
		for (const label of ["PRIVATE KEY", "RSA PRIVATE KEY"]) {
			const candidate = `-----BEGIN ${label}-----\n${wrapped}\n-----END ${label}-----\n`;
			const out = tryExport(candidate);
			if (out) return out;
		}
	}

	return key;
}

function tryExport(pem: string): string | null {
	try {
		return createPrivateKey(pem)
			.export({ type: "pkcs8", format: "pem" })
			.toString();
	} catch {
		return null;
	}
}

/** True if the (normalized) value is a usable private key. */
export function isValidPrivateKey(raw: string): boolean {
	try {
		createPrivateKey(normalizePrivateKey(raw));
		return true;
	} catch {
		return false;
	}
}
