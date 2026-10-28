import { z } from "zod";
import { errorResponse, handleUnexpected } from "@/lib/api/errors";
import { getStudentAssignment } from "@/lib/assignments/repository";

/** Student-safe: read from the view without reference answers. */
export async function GET(_request: Request, ctx: RouteContext<"/api/assignments/[id]">) {
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) {
    return errorResponse(400, "invalid_id", "Assignment id must be a valid UUID.");
  }
  try {
    const assignment = await getStudentAssignment(id);
    if (!assignment) return errorResponse(404, "not_found", "Assignment not found.");
    return Response.json({ assignment });
  } catch (error) {
    return handleUnexpected(error);
  }
}
