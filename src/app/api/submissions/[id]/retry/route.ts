import { z } from "zod";
import { errorResponse } from "@/lib/api/errors";
import { markInBackground } from "@/lib/grading/background";
import { submissionErrorResponse } from "@/lib/submissions/http";
import { defaultSubmissionDeps, getStudentSubmission } from "@/lib/submissions/repository";
import { retrySubmission } from "@/lib/submissions/service";

export const maxDuration = 60;

/** Tries a failed submission again from the stored file. Only failed submissions can be retried. */
export async function POST(_request: Request, ctx: RouteContext<"/api/submissions/[id]/retry">) {
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) return errorResponse(400, "invalid_id", "Submission id must be a valid UUID.");
  try {
    await retrySubmission(id, defaultSubmissionDeps());
    const submission = await getStudentSubmission(id);
    markInBackground(id); // a retry that has its text goes straight on to marking
    return Response.json({ submission });
  } catch (error) {
    return submissionErrorResponse(error);
  }
}
