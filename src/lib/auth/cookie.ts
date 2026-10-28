import "server-only";
import { cookies } from "next/headers";
import { SESSION_COOKIE, SESSION_MAX_AGE_SECONDS, type Session } from "./session";
import { authSecret, signSession } from "./token";

/** Thrown when there is no secret to sign the cookie with, so nobody can be signed in. */
export class AuthNotConfiguredError extends Error {
  constructor() {
    super("Sign-in is not set up on the server.");
    this.name = "AuthNotConfiguredError";
  }
}

/** Signs the user in: sets the signed, HttpOnly cookie. */
export async function startSession(session: Session): Promise<void> {
  const secret = authSecret();
  if (!secret) throw new AuthNotConfiguredError();
  (await cookies()).set(SESSION_COOKIE, signSession(session, secret), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
    secure: process.env.NODE_ENV === "production",
  });
}

export async function endSession(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}
