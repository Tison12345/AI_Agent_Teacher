import { errorResponse } from "@/lib/api/errors";
import { checkpointStore } from "@/lib/checkpoints/repository";
import { getPlan } from "@/lib/plans/repository";
import { getProject } from "@/lib/projects/repository";
import { quizStore } from "@/lib/quiz/repository";
import { buildProjectOverview } from "@/lib/review/overview";
import { invalidIdResponse, reviewErrorResponse } from "@/lib/review/http";
import { reviewStore } from "@/lib/review/repository";

/**
 * One project with every week: recorded state, AI recommendation, official outcome,
 * feedback and quiz result. Carries the AI score, so teachers only once login exists.
 */
export async function GET(_request: Request, ctx: RouteContext<"/api/faculty/projects/[id]">) {
  const { id } = await ctx.params;
  const invalid = invalidIdResponse(id, "Project");
  if (invalid) return invalid;
  try {
    const overview = await buildProjectOverview(id, {
      getProject,
      getPlan,
      checkpoints: checkpointStore,
      review: reviewStore,
      quizzes: quizStore,
    });
    if (!overview) return errorResponse(404, "not_found", "Project not found.");
    return Response.json(overview);
  } catch (error) {
    return reviewErrorResponse(error);
  }
}
