import { z } from "zod";
import { errorResponse } from "@/lib/api/errors";
import { defaultGradingDeps } from "@/lib/grading/repository";
import { gradeSubmission } from "@/lib/grading/service";
import { submissionErrorResponse } from "@/lib/submissions/http";
import { getFacultySubmission } from "@/lib/submissions/repository";

// Gemini is given up to 55 seconds per attempt.
export const maxDuration = 60;

/**
 * Demo build: no login. Runs the AI marking now for a submission whose text was read but which has no
 * recommendation yet (for example an upload from before marking existed). The result is only a recommendation.
 */
export async function POST(_request: Request, ctx: RouteContext<"/api/faculty/submissions/[id]/grade">) {
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) return errorResponse(400, "invalid_id", "Submission id must be a valid UUID.");
  try {
    const outcome = await gradeSubmission(id, defaultGradingDeps());
    if (outcome === "skipped") {
      return errorResponse(409, "not_ready", "Only a submission that has been read and is still processing can be marked.");
    }
    return Response.json({ outcome, submission: await getFacultySubmission(id) });
  } catch (error) {
    return submissionErrorResponse(error);
  }
}
