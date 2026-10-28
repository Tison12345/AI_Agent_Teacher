import { z } from "zod";
import { errorResponse } from "@/lib/api/errors";
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
    return Response.json({ submission: await getStudentSubmission(id) });
  } catch (error) {
    return submissionErrorResponse(error);
  }
}
