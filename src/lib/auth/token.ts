import { createHmac, timingSafeEqual } from "node:crypto";
import { SessionSchema, SESSION_MAX_AGE_SECONDS, type Session } from "./session";

/*
 * The sign-in cookie: the session as JSON plus an expiry, signed with HMAC-SHA256, so a browser cannot edit it to
 * become someone else or the other role. Server-side only (Node's crypto): the proxy, the routes and the pages.
 *
 * The signing secret is AUTH_SECRET if set, otherwise the Supabase secret key the server already has. With neither,
 * nobody can be signed in.
 */

const b64 = (buffer: Buffer) => buffer.toString("base64url");
const MIN_SECRET_LENGTH = 16;

/** The signing secret from the environment, or null when there is none worth using. */
export function authSecret(env: NodeJS.ProcessEnv = process.env): string | null {
  const secret = env.AUTH_SECRET?.trim() || env.SUPABASE_SECRET_KEY?.trim();
  return secret && secret.length >= MIN_SECRET_LENGTH ? secret : null;
}

const mac = (payload: string, secret: string) => createHmac("sha256", secret).update(payload).digest();

export function signSession(session: Session, secret: string, now = Date.now()): string {
  const payload = b64(Buffer.from(JSON.stringify({ ...session, exp: Math.floor(now / 1000) + SESSION_MAX_AGE_SECONDS })));
  return `${payload}.${b64(mac(payload, secret))}`;
}

/** The signed-in user from the cookie's value, or null when it is missing, forged, expired or not ours. */
export function verifySession(token: string | null | undefined, secret: string | null, now = Date.now()): Session | null {
  if (!token || !secret) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payload, signature] = parts;

  const expected = mac(payload, secret);
  let given: Buffer;
  try {
    given = Buffer.from(signature, "base64url");
  } catch {
    return null;
  }
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;

  try {
    const body: unknown = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    const exp = typeof body === "object" && body !== null && "exp" in body ? Number(body.exp) : NaN;
    if (!(exp * 1000 > now)) return null;
    const parsed = SessionSchema.safeParse(body);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
