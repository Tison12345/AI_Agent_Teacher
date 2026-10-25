import { z } from "zod";
import { errorResponse, handleUnexpected } from "@/lib/api/errors";
import { checkpointStore } from "@/lib/checkpoints/repository";
import { evaluationStore } from "@/lib/evaluation/repository";
import { getProject } from "@/lib/projects/repository";
import { MAX_DURATION_WEEKS } from "@/lib/validation/project";

/**
 * Full AI evaluation for a week, for teacher review and for inspecting this phase.
 * It includes the AI's suggested score, so it must be restricted to teachers once
 * login and permissions exist. Patch text is left out; the stored snapshot keeps it.
 */
export async function GET(
  _request: Request,
  ctx: RouteContext<"/api/projects/[id]/weeks/[week]/evaluation">,
) {
  const { id, week } = await ctx.params;
  const weekNumber = /^\d{1,2}$/.test(week) ? Number(week) : NaN;
  if (!z.uuid().safeParse(id).success) {
    return errorResponse(400, "invalid_id", "Project id must be a valid UUID.");
  }
  if (!(weekNumber >= 1 && weekNumber <= MAX_DURATION_WEEKS)) {
    return errorResponse(400, "invalid_week", `Week must be a whole number from 1 to ${MAX_DURATION_WEEKS}.`);
  }
  try {
    const project = await getProject(id);
    if (!project) return errorResponse(404, "not_found", "Project not found.");
    if (weekNumber > project.durationWeeks) {
      return errorResponse(400, "invalid_week", `This project lasts ${project.durationWeeks} ${project.durationWeeks === 1 ? "week" : "weeks"}, so the week must be from 1 to ${project.durationWeeks}.`);
    }
    const checkpoint = await checkpointStore.getCheckpoint(id, weekNumber);
    const stored = checkpoint ? await evaluationStore.getByCheckpoint(checkpoint.id) : null;
    if (!stored) return errorResponse(404, "not_found", `Week ${weekNumber} has no evaluation yet.`);

    return Response.json({
      evaluation: stored.evaluation,
      snapshot: {
        ...stored.snapshot,
        files: stored.snapshot.files.map(({ patch, ...file }) => ({
          ...file,
          patchIncluded: patch !== undefined,
          patchChars: patch?.length ?? 0,
        })),
      },
    });
  } catch (error) {
    return handleUnexpected(error);
  }
}
