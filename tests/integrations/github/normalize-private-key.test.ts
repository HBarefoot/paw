import { describe, expect, it } from "bun:test";
import { createPrivateKey, generateKeyPairSync } from "node:crypto";
import { normalizePrivateKey } from "../../../src/integrations/github/private-key.js";

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const pkcs8 = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const pkcs1 = privateKey.export({ type: "pkcs1", format: "pem" }).toString();

/** A normalized key must be a valid, parseable PKCS#8 PEM. */
function isValidPkcs8(pem: string): boolean {
	if (!pem.includes("-----BEGIN PRIVATE KEY-----")) return false;
	try {
		createPrivateKey(pem);
		return true;
	} catch {
		return false;
	}
}

describe("normalizePrivateKey", () => {
	it("passes a clean PKCS#8 key through", () => {
		expect(isValidPkcs8(normalizePrivateKey(pkcs8))).toBe(true);
	});

	it("repairs a key whose newlines were stripped (single-line paste)", () => {
		// This is the case that throws "Data provided to an operation does not
		// meet requirements" in Web Crypto.
		const flattened = pkcs8.replace(/\n/g, "");
		expect(isValidPkcs8(normalizePrivateKey(flattened))).toBe(true);
	});

	it("repairs a key with literal \\n escape sequences", () => {
		const escaped = pkcs8.replace(/\n/g, "\\n");
		expect(isValidPkcs8(normalizePrivateKey(escaped))).toBe(true);
	});

	it("converts a PKCS#1 (BEGIN RSA PRIVATE KEY) key to PKCS#8", () => {
		expect(isValidPkcs8(normalizePrivateKey(pkcs1))).toBe(true);
	});

	it("repairs a flattened PKCS#1 key", () => {
		expect(isValidPkcs8(normalizePrivateKey(pkcs1.replace(/\n/g, "")))).toBe(
			true,
		);
	});

	it("trims surrounding whitespace", () => {
		expect(isValidPkcs8(normalizePrivateKey(`\n  ${pkcs8}  \n`))).toBe(true);
	});

	it("returns empty input unchanged", () => {
		expect(normalizePrivateKey("")).toBe("");
	});
});
