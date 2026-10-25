import { z } from "zod";
import { errorResponse, handleUnexpected } from "@/lib/api/errors";
import { getProject } from "@/lib/projects/repository";

export async function GET(
  _request: Request,
  ctx: RouteContext<"/api/projects/[id]">,
) {
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) {
    return errorResponse(400, "invalid_id", "Project id must be a valid UUID.");
  }
  try {
    const project = await getProject(id);
    if (!project) return errorResponse(404, "not_found", "Project not found.");
    return Response.json({ project });
  } catch (error) {
    return handleUnexpected(error);
  }
}
