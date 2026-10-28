import { z } from "zod";
import { errorResponse } from "@/lib/api/errors";
import { submissionErrorResponse } from "@/lib/submissions/http";
import { getFacultySubmission } from "@/lib/submissions/repository";
import { LeaseHeldError } from "@/lib/workflow/lease";
import { getSubmissionRunner } from "@/lib/workflow/submission";

// Gemini is given up to 55 seconds per attempt.
export const maxDuration = 60;

/**
 * Demo build: faculty sign-in only (src/proxy.ts), not production security. Runs the marking workflow now for a submission that is still processing (for example an
 * upload from before marking existed). The result is only a recommendation; the run then waits for faculty.
 */
export async function POST(_request: Request, ctx: RouteContext<"/api/faculty/submissions/[id]/grade">) {
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) return errorResponse(400, "invalid_id", "Submission id must be a valid UUID.");
  try {
    const { outcome } = await getSubmissionRunner().start(id);
    if (outcome === "skipped") {
      return errorResponse(409, "not_ready", "Only a submission that has been read and is still processing can be marked.");
    }
    const submission = await getFacultySubmission(id);
    return Response.json({ outcome: outcome === "failed" ? "failed" : "graded", submission });
  } catch (error) {
    if (error instanceof LeaseHeldError) return errorResponse(409, "already_running", "This submission is already being marked.");
    return submissionErrorResponse(error);
  }
}
