import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/lib/auth/session";

/** Signs out (demo sign-in): removes the cookie. */
export async function POST() {
  (await cookies()).delete(SESSION_COOKIE);
  return Response.json({ ok: true });
}
