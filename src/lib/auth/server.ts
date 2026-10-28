import "server-only";
import { cookies } from "next/headers";
import { errorResponse } from "@/lib/api/errors";
import { SESSION_COOKIE, type Session } from "./session";
import { authSecret, verifySession } from "./token";

/** The signed-in user for this request, or null. Reading it makes the page request-time. */
export async function getSession(): Promise<Session | null> {
  return verifySession((await cookies()).get(SESSION_COOKIE)?.value, authSecret());
}

/**
 * The signed-in student, or the 401/403 response to send instead. Creating a project or uploading an assignment
 * needs one, so the new record can be linked to the student's account (the faculty dashboard groups by student).
 */
export async function requireStudent(action: string): Promise<Session | Response> {
  const session = await getSession();
  if (!session) return errorResponse(401, "unauthorized", `Sign in as a student to ${action}.`);
  if (session.role !== "student") return errorResponse(403, "forbidden", `Only students can ${action}.`);
  return session;
}
