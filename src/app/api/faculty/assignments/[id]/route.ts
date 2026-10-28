import { z } from "zod";
import { errorResponse, handleUnexpected } from "@/lib/api/errors";
import { getFacultyAssignment } from "@/lib/assignments/repository";

// Demo build: demo faculty sign-in only (src/proxy.ts). Carries the reference answers, so it is for faculty screens only.
export async function GET(_request: Request, ctx: RouteContext<"/api/faculty/assignments/[id]">) {
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) {
    return errorResponse(400, "invalid_id", "Assignment id must be a valid UUID.");
  }
  try {
    const assignment = await getFacultyAssignment(id);
    if (!assignment) return errorResponse(404, "not_found", "Assignment not found.");
    return Response.json({ assignment });
  } catch (error) {
    return handleUnexpected(error);
  }
}
