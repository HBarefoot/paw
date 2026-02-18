import { createHmac } from "node:crypto";

// Base32 alphabet (RFC 4648)
const BASE32_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let result = "";
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      result += BASE32_CHARS[(value >>> bits) & 0x1f];
    }
  }
  if (bits > 0) {
    result += BASE32_CHARS[(value << (5 - bits)) & 0x1f];
  }
  return result;
}

export function base32Decode(encoded: string): Buffer {
  const stripped = encoded.replace(/=+$/, "").toUpperCase();
  const bytes: number[] = [];
  let bits = 0;
  let value = 0;
  for (const char of stripped) {
    const idx = BASE32_CHARS.indexOf(char);
    if (idx === -1) throw new Error(`Invalid base32 character: ${char}`);
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((value >>> bits) & 0xff);
    }
  }
  return Buffer.from(bytes);
}

export function generateSecret(length = 20): string {
  const bytes = Buffer.from(crypto.getRandomValues(new Uint8Array(length)));
  return base32Encode(bytes);
}

function hmacSha1(key: Buffer, data: Buffer): Buffer {
  return createHmac("sha1", key).update(data).digest();
}

export function generateTotpCode(secret: string, timeStep = 30, digits = 6, now?: number): string {
  const time = Math.floor((now ?? Date.now()) / 1000 / timeStep);
  const timeBuffer = Buffer.alloc(8);
  // Write as big-endian 64-bit integer
  timeBuffer.writeUInt32BE(Math.floor(time / 0x100000000), 0);
  timeBuffer.writeUInt32BE(time >>> 0, 4);

  const key = base32Decode(secret);
  const hash = hmacSha1(key, timeBuffer);

  // Dynamic truncation (RFC 4226 section 5.4)
  const offset = hash[hash.length - 1] & 0x0f;
  const code =
    ((hash[offset] & 0x7f) << 24) |
    ((hash[offset + 1] & 0xff) << 16) |
    ((hash[offset + 2] & 0xff) << 8) |
    (hash[offset + 3] & 0xff);

  return String(code % 10 ** digits).padStart(digits, "0");
}

export function verifyTotp(secret: string, code: string, window = 1): boolean {
  const now = Date.now();
  for (let i = -window; i <= window; i++) {
    const adjustedTime = now + i * 30 * 1000;
    if (generateTotpCode(secret, 30, 6, adjustedTime) === code) {
      return true;
    }
  }
  return false;
}

export function buildOtpauthUri(secret: string, issuer: string, account: string): string {
  const encodedIssuer = encodeURIComponent(issuer);
  const encodedAccount = encodeURIComponent(account);
  return `otpauth://totp/${encodedIssuer}:${encodedAccount}?secret=${secret}&issuer=${encodedIssuer}&algorithm=SHA1&digits=6&period=30`;
}
