import { z } from "zod";
import { errorResponse, handleUnexpected } from "@/lib/api/errors";
import { getFacultySubmission } from "@/lib/submissions/repository";

// Demo build: no login. Carries the extracted text and a short-lived link to the original file.
export async function GET(_request: Request, ctx: RouteContext<"/api/faculty/submissions/[id]">) {
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) return errorResponse(400, "invalid_id", "Submission id must be a valid UUID.");
  try {
    const submission = await getFacultySubmission(id);
    if (!submission) return errorResponse(404, "not_found", "Submission not found.");
    return Response.json({ submission });
  } catch (error) {
    return handleUnexpected(error);
  }
}
