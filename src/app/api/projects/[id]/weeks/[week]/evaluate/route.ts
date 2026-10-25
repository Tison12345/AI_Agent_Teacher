import { errorResponse } from "@/lib/api/errors";
import { checkpointStore } from "@/lib/checkpoints/repository";
import { evaluationErrorResponse } from "@/lib/evaluation/http";
import { evaluationStore } from "@/lib/evaluation/repository";
import { evaluateWeek } from "@/lib/evaluation/service";
import { getGeminiClient, getGeminiModel } from "@/lib/gemini/client";
import { getGitHubClient } from "@/lib/github/client";
import { loadProjectRepo } from "@/lib/github/project-repo";
import { getPlan } from "@/lib/plans/repository";
import { PROJECT_DURATION_WEEKS } from "@/lib/validation/project";

// Fetching the diff and asking Gemini can take a while.
export const maxDuration = 60;

/**
 * Creates the AI evaluation for a recorded week and submits it for teacher review.
 * The response deliberately contains no score: the AI's suggestion is for the
 * teacher, and only teacher-approved marks are shown to students.
 */
export async function POST(
  _request: Request,
  ctx: RouteContext<"/api/projects/[id]/weeks/[week]/evaluate">,
) {
  const { id, week } = await ctx.params;
  const weekNumber = /^\d{1,2}$/.test(week) ? Number(week) : NaN;
  if (!(weekNumber >= 1 && weekNumber <= PROJECT_DURATION_WEEKS)) {
    return errorResponse(400, "invalid_week", `Week must be a whole number from 1 to ${PROJECT_DURATION_WEEKS}.`);
  }
  try {
    const target = await loadProjectRepo(id);
    if (target instanceof Response) return target;

    // Fail fast, before any GitHub or Gemini work, if Gemini is not configured.
    const client = getGeminiClient();
    const { evaluation } = await evaluateWeek(
      { projectId: id, weekNumber, ...target },
      {
        checkpoints: checkpointStore,
        evaluations: evaluationStore,
        getPlan,
        github: getGitHubClient(),
        gemini: { client, model: getGeminiModel() },
      },
    );
    return Response.json(
      {
        evaluation: {
          id: evaluation.id,
          weekNumber: evaluation.weekNumber,
          status: evaluation.status,
          createdAt: evaluation.createdAt,
        },
      },
      { status: 201 },
    );
  } catch (error) {
    return evaluationErrorResponse(error);
  }
}
