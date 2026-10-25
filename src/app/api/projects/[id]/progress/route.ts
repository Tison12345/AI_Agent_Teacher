import { z } from "zod";
import { errorResponse, handleUnexpected } from "@/lib/api/errors";
import { checkpointStore } from "@/lib/checkpoints/repository";
import { getProgress } from "@/lib/checkpoints/service";
import { evaluationStore } from "@/lib/evaluation/repository";
import { getProject } from "@/lib/projects/repository";

/** Baseline, recorded checkpoints and evaluation statuses for a project (no GitHub call). */
export async function GET(_request: Request, ctx: RouteContext<"/api/projects/[id]/progress">) {
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) {
    return errorResponse(400, "invalid_id", "Project id must be a valid UUID.");
  }
  try {
    if (!(await getProject(id))) return errorResponse(404, "not_found", "Project not found.");
    const [progress, evaluations] = await Promise.all([
      getProgress(id, checkpointStore),
      evaluationStore.listStatuses(id),
    ]);
    // Statuses only. The AI's score is for the teacher and is never sent here.
    return Response.json({ ...progress, evaluations });
  } catch (error) {
    return handleUnexpected(error);
  }
}
