import { errorResponse, handleUnexpected } from "@/lib/api/errors";
import { checkpointStore } from "@/lib/checkpoints/repository";
import { getProject } from "@/lib/projects/repository";
import { MAX_DURATION_WEEKS } from "@/lib/validation/project";
import { notStartedEvaluationProgress } from "@/lib/workflow/evaluation/progress";
import { getEvaluationRunner, resumeEvaluationInBackground } from "@/lib/workflow/evaluation";
import { z } from "zod";

/**
 * Where a week's evaluation is in its workflow, read from the graph's checkpoint. This is an allowlisted
 * projection (step names and statuses, an attempt number, waiting-for-teacher, a fixed sentence per failure).
 * It never contains the AI's suggested score, its feedback, the code changes or validation issues, so the
 * student who triggered the evaluation can poll it.
 */
export async function GET(_request: Request, ctx: RouteContext<"/api/projects/[id]/weeks/[week]/workflow">) {
  const { id, week } = await ctx.params;
  const weekNumber = /^\d{1,2}$/.test(week) ? Number(week) : NaN;
  if (!z.uuid().safeParse(id).success) return errorResponse(400, "invalid_id", "Project id must be a valid UUID.");
  if (!(weekNumber >= 1 && weekNumber <= MAX_DURATION_WEEKS)) {
    return errorResponse(400, "invalid_week", `Week must be a whole number from 1 to ${MAX_DURATION_WEEKS}.`);
  }
  try {
    const project = await getProject(id);
    if (!project) return errorResponse(404, "not_found", "Project not found.");
    const checkpoint = await checkpointStore.getCheckpoint(id, weekNumber);
    const progress = checkpoint ? await getEvaluationRunner().progress(checkpoint.id) : notStartedEvaluationProgress();
    return Response.json({ progress }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return handleUnexpected(error);
  }
}

/**
 * Continues an evaluation that stopped part-way (its process was stopped or crashed) from the step it reached.
 * It only acts on a run that is really stalled: one that is running, finished or waiting for the teacher is
 * left alone. Nothing stored (the evaluation, the teacher's decision) is changed by this.
 */
export async function POST(_request: Request, ctx: RouteContext<"/api/projects/[id]/weeks/[week]/workflow">) {
  const { id, week } = await ctx.params;
  const weekNumber = /^\d{1,2}$/.test(week) ? Number(week) : NaN;
  if (!z.uuid().safeParse(id).success) return errorResponse(400, "invalid_id", "Project id must be a valid UUID.");
  if (!(weekNumber >= 1 && weekNumber <= MAX_DURATION_WEEKS)) {
    return errorResponse(400, "invalid_week", `Week must be a whole number from 1 to ${MAX_DURATION_WEEKS}.`);
  }
  try {
    if (!(await getProject(id))) return errorResponse(404, "not_found", "Project not found.");
    const checkpoint = await checkpointStore.getCheckpoint(id, weekNumber);
    if (!checkpoint) return errorResponse(409, "not_stalled", "This week has no evaluation workflow to continue.");
    const runner = getEvaluationRunner();
    if ((await runner.progress(checkpoint.id)).state !== "stalled") {
      return errorResponse(409, "not_stalled", "This evaluation is not stalled, so there is nothing to continue.");
    }
    resumeEvaluationInBackground(runner, checkpoint.id);
    return Response.json({ workflow: { state: "running" } }, { status: 202 });
  } catch (error) {
    return handleUnexpected(error);
  }
}
