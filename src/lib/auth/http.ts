import "server-only";
import { errorResponse } from "@/lib/api/errors";
import { AuthNotConfiguredError, startSession } from "./cookie";
import { safeNext } from "./session";
import type { AuthResult } from "./service";

/** Turns the outcome of a sign-in or sign-up into the response, setting the cookie when it worked. */
export async function authResponse(result: AuthResult, next: unknown): Promise<Response> {
  if (!result.ok) return errorResponse(result.status, result.code, result.message, result.fields);
  try {
    await startSession(result.session);
  } catch (error) {
    if (error instanceof AuthNotConfiguredError) return errorResponse(503, "auth_unavailable", "Sign-in is not set up on the server yet.");
    throw error;
  }
  return Response.json({ session: result.session, redirect: safeNext(typeof next === "string" ? next : null, result.session.role) });
}
