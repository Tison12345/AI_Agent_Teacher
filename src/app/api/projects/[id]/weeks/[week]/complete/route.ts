import { errorResponse } from "@/lib/api/errors";
import { checkpointErrorResponse } from "@/lib/checkpoints/http";
import { checkpointStore } from "@/lib/checkpoints/repository";
import { completeWeek } from "@/lib/checkpoints/service";
import { getGitHubClient } from "@/lib/github/client";
import { loadProjectRepo } from "@/lib/github/project-repo";
import { PROJECT_DURATION_WEEKS } from "@/lib/validation/project";

/**
 * "Complete Week": records the latest pushed commit as this week's checkpoint.
 * This only records evidence. It is not an evaluation and gives no marks.
 */
export async function POST(
  _request: Request,
  ctx: RouteContext<"/api/projects/[id]/weeks/[week]/complete">,
) {
  const { id, week } = await ctx.params;
  const weekNumber = /^\d{1,2}$/.test(week) ? Number(week) : NaN;
  if (!(weekNumber >= 1 && weekNumber <= PROJECT_DURATION_WEEKS)) {
    return errorResponse(400, "invalid_week", `Week must be a whole number from 1 to ${PROJECT_DURATION_WEEKS}.`);
  }
  try {
    const target = await loadProjectRepo(id);
    if (target instanceof Response) return target;
    const checkpoint = await completeWeek(
      { projectId: id, weekNumber, ...target },
      { store: checkpointStore, github: getGitHubClient() },
    );
    return Response.json({ checkpoint }, { status: 201 });
  } catch (error) {
    return checkpointErrorResponse(error);
  }
}
