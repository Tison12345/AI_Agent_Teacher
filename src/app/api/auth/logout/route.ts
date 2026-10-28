import { endSession } from "@/lib/auth/cookie";

/** Signs out: removes the cookie. */
export async function POST() {
  await endSession();
  return Response.json({ ok: true });
}
