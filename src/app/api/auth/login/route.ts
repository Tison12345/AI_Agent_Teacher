import { cookies } from "next/headers";
import { errorResponse } from "@/lib/api/errors";
import { checkLogin, safeNext, serializeSession, SESSION_COOKIE, SESSION_MAX_AGE_SECONDS } from "@/lib/auth/session";

/**
 * DEMO-ONLY sign-in: a role, an email and the shared demo password. Sets a cookie saying who signed in. There is no
 * account store and nothing is written to the database. See lib/auth/session.ts.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, "invalid_json", "The request body must be valid JSON.");
  }

  const checked = checkLogin(body);
  if (!checked.ok) {
    const wrongPassword = checked.fields.password === "Wrong password.";
    return errorResponse(wrongPassword ? 401 : 400, wrongPassword ? "invalid_credentials" : "validation_failed", wrongPassword ? "Wrong password." : "Please fix the highlighted fields.", checked.fields);
  }

  (await cookies()).set(SESSION_COOKIE, serializeSession(checked.session), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
    secure: process.env.NODE_ENV === "production",
  });
  const next = (body as { next?: unknown }).next;
  return Response.json({ session: checked.session, redirect: safeNext(typeof next === "string" ? next : null, checked.session.role) });
}
