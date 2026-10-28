import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

/*
 * Passwords are stored only as scrypt hashes with a random salt (Node's built-in crypto: no package). The stored
 * text is "scrypt$N$r$p$salt$hash", so the cost can change later without breaking old hashes.
 */

const N = 16384;
const R = 8;
const P = 1;
const KEY_LENGTH = 64;

const derive = (password: string, salt: Buffer, n: number, r: number, p: number) =>
  new Promise<Buffer>((resolve, reject) => {
    scrypt(password, salt, KEY_LENGTH, { N: n, r, p, maxmem: 64 * 1024 * 1024 }, (error, key) => (error ? reject(error) : resolve(key)));
  });

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, N, R, P);
  return ["scrypt", N, R, P, salt.toString("base64url"), key.toString("base64url")].join("$");
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [n, r, p] = [Number(parts[1]), Number(parts[2]), Number(parts[3])];
  if (![n, r, p].every((value) => Number.isInteger(value) && value > 0)) return false;
  try {
    const expected = Buffer.from(parts[5], "base64url");
    const actual = await derive(password, Buffer.from(parts[4], "base64url"), n, r, p);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

/** A real hash of a password nobody has, so a sign-in for an unknown email takes as long as one for a known email. */
let decoy: Promise<string> | null = null;
export const decoyHash = () => (decoy ??= hashPassword(randomBytes(16).toString("hex")));
