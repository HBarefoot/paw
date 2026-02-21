import { describe, test, expect } from "bun:test";
import {
	base32Encode,
	base32Decode,
	generateSecret,
	generateTotpCode,
	verifyTotp,
	buildOtpauthUri,
} from "../../src/security/totp.js";

describe("Base32", () => {
	test("encode and decode round-trip", () => {
		const original = Buffer.from("Hello, World!");
		const encoded = base32Encode(original);
		const decoded = base32Decode(encoded);
		expect(decoded.toString()).toBe("Hello, World!");
	});

	test("encodes known value", () => {
		// "f" -> "MY" in base32
		expect(base32Encode(Buffer.from("f"))).toBe("MY");
		// "fo" -> "MZXQ"
		expect(base32Encode(Buffer.from("fo"))).toBe("MZXQ");
		// "foo" -> "MZXW6"
		expect(base32Encode(Buffer.from("foo"))).toBe("MZXW6");
	});

	test("decodes known value", () => {
		expect(base32Decode("MY").toString()).toBe("f");
		expect(base32Decode("MZXQ").toString()).toBe("fo");
	});

	test("decode rejects invalid characters", () => {
		expect(() => base32Decode("!!!")).toThrow("Invalid base32 character");
	});
});

describe("generateSecret", () => {
	test("returns a non-empty base32 string", () => {
		const secret = generateSecret();
		expect(secret.length).toBeGreaterThan(0);
		// Should only contain valid base32 characters
		expect(/^[A-Z2-7]+$/.test(secret)).toBe(true);
	});

	test("generates different secrets each time", () => {
		const s1 = generateSecret();
		const s2 = generateSecret();
		expect(s1).not.toBe(s2);
	});
});

describe("generateTotpCode", () => {
	test("produces a 6-digit string", () => {
		const secret = generateSecret();
		const code = generateTotpCode(secret);
		expect(code).toMatch(/^\d{6}$/);
	});

	test("same secret and time produce same code", () => {
		const secret = generateSecret();
		const now = Date.now();
		const code1 = generateTotpCode(secret, 30, 6, now);
		const code2 = generateTotpCode(secret, 30, 6, now);
		expect(code1).toBe(code2);
	});

	test("different time steps produce different codes", () => {
		const secret = generateSecret();
		const now = Date.now();
		const code1 = generateTotpCode(secret, 30, 6, now);
		// Jump forward by 60 seconds (2 time steps)
		const code2 = generateTotpCode(secret, 30, 6, now + 60000);
		expect(code1).not.toBe(code2);
	});

	// RFC 6238 test vector: SHA1 secret = "12345678901234567890" (ASCII)
	test("RFC 6238 test vector at T=59", () => {
		const secret = base32Encode(Buffer.from("12345678901234567890"));
		// At time = 59, time step = 30 -> counter = 1
		// Expected TOTP: 287082
		const code = generateTotpCode(secret, 30, 6, 59 * 1000);
		expect(code).toBe("287082");
	});
});

describe("verifyTotp", () => {
	test("verifies current code", () => {
		const secret = generateSecret();
		const code = generateTotpCode(secret);
		expect(verifyTotp(secret, code)).toBe(true);
	});

	test("rejects wrong code", () => {
		const secret = generateSecret();
		expect(verifyTotp(secret, "000000")).toBe(false);
	});

	test("accepts code from adjacent time window", () => {
		const secret = generateSecret();
		const now = Date.now();
		// Generate code for 30 seconds ago (previous window)
		const code = generateTotpCode(secret, 30, 6, now - 30000);
		expect(verifyTotp(secret, code, 1)).toBe(true);
	});
});

describe("buildOtpauthUri", () => {
	test("builds valid URI", () => {
		const uri = buildOtpauthUri("JBSWY3DPEHPK3PXP", "Paw", "admin");
		expect(uri).toContain("otpauth://totp/");
		expect(uri).toContain("secret=JBSWY3DPEHPK3PXP");
		expect(uri).toContain("issuer=Paw");
		expect(uri).toContain("algorithm=SHA1");
		expect(uri).toContain("digits=6");
		expect(uri).toContain("period=30");
	});

	test("encodes special characters", () => {
		const uri = buildOtpauthUri("SECRET", "My App", "user@example.com");
		expect(uri).toContain("My%20App");
		expect(uri).toContain("user%40example.com");
	});
});
