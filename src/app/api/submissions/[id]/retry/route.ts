import { z } from "zod";
import { errorResponse } from "@/lib/api/errors";
import { submissionErrorResponse } from "@/lib/submissions/http";
import { defaultSubmissionDeps, getStudentSubmission } from "@/lib/submissions/repository";
import { retrySubmission } from "@/lib/submissions/service";
import { startInBackground } from "@/lib/workflow/submission";

export const maxDuration = 60;

/** Tries a failed submission again from the stored file. Only failed submissions can be retried. */
export async function POST(_request: Request, ctx: RouteContext<"/api/submissions/[id]/retry">) {
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) return errorResponse(400, "invalid_id", "Submission id must be a valid UUID.");
  try {
    await retrySubmission(id, defaultSubmissionDeps());
    const submission = await getStudentSubmission(id);
    startInBackground(id); // a new workflow run: text already read is reused, not read again
    return Response.json({ submission });
  } catch (error) {
    return submissionErrorResponse(error);
  }
}
