import { z } from "zod";
import { errorResponse, handleUnexpected } from "@/lib/api/errors";
import { checkpointStore } from "@/lib/checkpoints/repository";
import { getProgress } from "@/lib/checkpoints/service";
import { getProject } from "@/lib/projects/repository";

/** Baseline and recorded checkpoints for a project (no GitHub call). */
export async function GET(_request: Request, ctx: RouteContext<"/api/projects/[id]/progress">) {
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) {
    return errorResponse(400, "invalid_id", "Project id must be a valid UUID.");
  }
  try {
    if (!(await getProject(id))) return errorResponse(404, "not_found", "Project not found.");
    return Response.json(await getProgress(id, checkpointStore));
  } catch (error) {
    return handleUnexpected(error);
  }
}
