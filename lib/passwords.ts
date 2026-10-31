import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

// scrypt password hashes for NEXUS_USERS. Format:
//   scrypt$<N>$<r>$<p>$<salt base64>$<hash base64>
// Node-only (Server Actions and scripts); never imported by proxy.ts.

const N = 16384;
const R = 8;
const P = 1;
const KEYLEN = 32;

export function hashPassword(password: string, salt: Buffer = randomBytes(16)): string {
  if (password.length < 12) throw new Error("Passwords must be at least 12 characters.");
  const hash = scryptSync(password, salt, KEYLEN, { N, r: R, p: P });
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64")}$${hash.toString("base64")}`;
}

const DUMMY = `scrypt$${N}$${R}$${P}$${Buffer.alloc(16).toString("base64")}$${Buffer.alloc(KEYLEN).toString("base64")}`;

/** Constant-time verify. Pass `undefined` for an unknown user so timing does not reveal it. */
export function verifyPassword(password: string, stored: string | undefined): boolean {
  const parts = (stored ?? DUMMY).split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, n, r, p, saltB64, hashB64] = parts;
  const expected = Buffer.from(hashB64, "base64");
  let actual: Buffer;
  try {
    actual = scryptSync(password, Buffer.from(saltB64, "base64"), expected.length, { N: Number(n), r: Number(r), p: Number(p) });
  } catch {
    return false;
  }
  return stored !== undefined && actual.length === expected.length && timingSafeEqual(actual, expected);
}
