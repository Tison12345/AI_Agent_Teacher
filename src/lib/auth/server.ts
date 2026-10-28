import "server-only";
import { cookies } from "next/headers";
import { parseSession, SESSION_COOKIE, type Session } from "./session";

/** The signed-in user for this request (demo sign-in), or null. Reading it makes the page request-time. */
export async function getSession(): Promise<Session | null> {
  return parseSession((await cookies()).get(SESSION_COOKIE)?.value);
}
