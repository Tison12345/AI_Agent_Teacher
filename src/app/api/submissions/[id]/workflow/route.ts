import { z } from "zod";
import { errorResponse, handleUnexpected } from "@/lib/api/errors";
import { getStudentSubmission } from "@/lib/submissions/repository";
import { getSubmissionRunner, resumeInBackground } from "@/lib/workflow/submission";

/**
 * Where a submission is in its workflow, read from the graph's checkpoint. This is an allowlisted projection
 * (step names and statuses, an attempt number, waiting-for-faculty, a fixed sentence per failure). It never
 * contains the extracted text, the AI's output, validation issues, marks or feedback, so students and faculty
 * can both poll it.
 */
export async function GET(_request: Request, ctx: RouteContext<"/api/submissions/[id]/workflow">) {
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) return errorResponse(400, "invalid_id", "Submission id must be a valid UUID.");
  try {
    if (!(await getStudentSubmission(id))) return errorResponse(404, "not_found", "Submission not found.");
    return Response.json({ progress: await getSubmissionRunner().progress(id) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return handleUnexpected(error);
  }
}

/**
 * Continues a run that stopped part-way (its process was stopped or crashed) from the step it reached. It only
 * acts on a run that is really stalled: one that is running, finished or waiting for faculty is left alone.
 * The submission's own decision and data are never touched by this.
 */
export async function POST(_request: Request, ctx: RouteContext<"/api/submissions/[id]/workflow">) {
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) return errorResponse(400, "invalid_id", "Submission id must be a valid UUID.");
  try {
    if (!(await getStudentSubmission(id))) return errorResponse(404, "not_found", "Submission not found.");
    const runner = getSubmissionRunner();
    if ((await runner.progress(id)).state !== "stalled") {
      return errorResponse(409, "not_stalled", "This submission's workflow is not stalled, so there is nothing to continue.");
    }
    resumeInBackground(id);
    return Response.json({ workflow: { state: "running" } }, { status: 202 });
  } catch (error) {
    return handleUnexpected(error);
  }
}
