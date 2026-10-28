// @vitest-environment node
import { describe, expect, it } from "vitest";
import { SESSION_MAX_AGE_SECONDS, type Session } from "./session";
import { authSecret, signSession, verifySession } from "./token";

const SECRET = "test-secret-0123456789";
const session: Session = { id: "11111111-1111-4111-8111-111111111111", role: "student", email: "asha.fictional@gmail.com", name: "Asha Fictional" };
const NOW = Date.UTC(2026, 9, 29, 12, 0, 0);

describe("signed sign-in cookie", () => {
  it("round-trips a signed-in user", () => {
    expect(verifySession(signSession(session, SECRET, NOW), SECRET, NOW + 1000)).toEqual(session);
  });

  it("a cookie edited by the browser is refused, whatever was changed", () => {
    const [payload, signature] = signSession(session, SECRET, NOW).split(".");
    const forged = Buffer.from(JSON.stringify({ ...session, role: "faculty", exp: Math.floor(NOW / 1000) + 3600 })).toString("base64url");
    expect(verifySession(`${forged}.${signature}`, SECRET, NOW)).toBeNull(); // new content, old signature
    expect(verifySession(`${payload}.${signature.slice(0, -2)}AA`, SECRET, NOW)).toBeNull(); // damaged signature
    expect(verifySession(`${payload}.`, SECRET, NOW)).toBeNull();
    expect(verifySession(payload, SECRET, NOW)).toBeNull();
  });

  it("a cookie signed with another secret is refused, and so is one when there is no secret", () => {
    const token = signSession(session, SECRET, NOW);
    expect(verifySession(token, "another-secret-0123456789", NOW)).toBeNull();
    expect(verifySession(token, null, NOW)).toBeNull();
  });

  it("expires after the sign-in lifetime", () => {
    const token = signSession(session, SECRET, NOW);
    expect(verifySession(token, SECRET, NOW + (SESSION_MAX_AGE_SECONDS - 1) * 1000)).toEqual(session);
    expect(verifySession(token, SECRET, NOW + (SESSION_MAX_AGE_SECONDS + 1) * 1000)).toBeNull();
  });

  it("refuses anything that is not a token", () => {
    for (const value of [undefined, null, "", "garbage", "a.b.c", "student", "%7B%7D", encodeURIComponent(JSON.stringify(session))]) {
      expect(verifySession(value, SECRET, NOW)).toBeNull();
    }
  });

  it("refuses a correctly signed payload that is not a session", () => {
    expect(verifySession(signSession({ id: "11111111-1111-4111-8111-111111111111", role: "admin", email: "a@b.co", name: "Admin" } as never, SECRET, NOW), SECRET, NOW)).toBeNull();
    expect(verifySession(signSession({ role: "faculty", email: "a@b.co", name: "Old" } as never, SECRET, NOW), SECRET, NOW)).toBeNull(); // an old cookie with no account id
  });
});

describe("authSecret", () => {
  it("prefers AUTH_SECRET, falls back to the Supabase secret key, and needs something long enough", () => {
    expect(authSecret({ AUTH_SECRET: "a".repeat(20), SUPABASE_SECRET_KEY: "b".repeat(20) } as never)).toBe("a".repeat(20));
    expect(authSecret({ SUPABASE_SECRET_KEY: "b".repeat(20) } as never)).toBe("b".repeat(20));
    expect(authSecret({ AUTH_SECRET: "short" } as never)).toBeNull();
    expect(authSecret({} as never)).toBeNull();
  });
});
