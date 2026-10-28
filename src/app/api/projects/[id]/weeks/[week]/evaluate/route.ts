import { errorResponse } from "@/lib/api/errors";
import { checkpointStore } from "@/lib/checkpoints/repository";
import { evaluationErrorResponse } from "@/lib/evaluation/http";
import { evaluationStore } from "@/lib/evaluation/repository";
import { loadEvaluationContext } from "@/lib/evaluation/service";
import { getGeminiClient } from "@/lib/gemini/client";
import { loadProjectRepo } from "@/lib/github/project-repo";
import { getPlan } from "@/lib/plans/repository";
import { MAX_DURATION_WEEKS } from "@/lib/validation/project";
import { getEvaluationRunner, startEvaluationInBackground } from "@/lib/workflow/evaluation";

/**
 * Starts the AI evaluation of a recorded week; it runs in the background as a workflow and ends waiting for
 * the teacher's review. The reply is 202 and deliberately contains no score: the AI's suggestion is for the
 * teacher, and only teacher-approved marks are shown to students. Follow it at .../weeks/[week]/workflow.
 */
export async function POST(
  _request: Request,
  ctx: RouteContext<"/api/projects/[id]/weeks/[week]/evaluate">,
) {
  const { id, week } = await ctx.params;
  const weekNumber = /^\d{1,2}$/.test(week) ? Number(week) : NaN;
  if (!(weekNumber >= 1 && weekNumber <= MAX_DURATION_WEEKS)) {
    return errorResponse(400, "invalid_week", `Week must be a whole number from 1 to ${MAX_DURATION_WEEKS}.`);
  }
  try {
    const target = await loadProjectRepo(id);
    if (target instanceof Response) return target;
    if (weekNumber > target.durationWeeks) {
      return errorResponse(400, "invalid_week", `This project lasts ${target.durationWeeks} ${target.durationWeeks === 1 ? "week" : "weeks"}, so the week must be from 1 to ${target.durationWeeks}.`);
    }

    // Fail fast, before any run starts, if Gemini or the workflow database is not set up.
    getGeminiClient();
    const runner = getEvaluationRunner();

    // Refuse early, with the same answers as before, when there is nothing to evaluate or it already was.
    const { checkpoint } = await loadEvaluationContext(
      { projectId: id, weekNumber },
      { checkpoints: checkpointStore, evaluations: evaluationStore, getPlan },
    );
    // The page that asked follows the new run: it ignores whatever the previous run ended with.
    const { run: afterRun } = await runner.progress(checkpoint.id);
    startEvaluationInBackground(runner, {
      projectId: id,
      weekNumber,
      checkpointId: checkpoint.id,
      owner: target.owner,
      repo: target.repo,
    });
    return Response.json({ workflow: { state: "running", afterRun } }, { status: 202 });
  } catch (error) {
    return evaluationErrorResponse(error);
  }
}
