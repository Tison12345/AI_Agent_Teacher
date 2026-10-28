import { errorResponse, handleUnexpected } from "@/lib/api/errors";
import { authResponse } from "@/lib/auth/http";
import { signIn } from "@/lib/auth/service";
import { userStore } from "@/lib/auth/users";

/** Signs in with a role, an email and a password. Sets a signed cookie. See lib/auth/session.ts. */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, "invalid_json", "The request body must be valid JSON.");
  }
  try {
    return await authResponse(await signIn(body, userStore), (body as { next?: unknown } | null)?.next);
  } catch (error) {
    return handleUnexpected(error);
  }
}
