import { z } from "zod";
import { errorResponse, handleUnexpected } from "@/lib/api/errors";
import { DecisionError, decideSubmission } from "@/lib/grading/repository";
import { getFacultySubmission } from "@/lib/submissions/repository";
import { submissionDecisionSchema } from "@/lib/validation/submission-decision";
import { getSubmissionRunner } from "@/lib/workflow/submission";

/**
 * Demo build: faculty sign-in only (src/proxy.ts), not production security. The official decision: approve the AI's recommendation, edit it, or reject. It is final.
 * The browser sends only the choice (and, for an edit, marks, feedback and a comment): the totals are computed
 * and every rule is enforced in the database.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/faculty/submissions/[id]/decision">) {
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) return errorResponse(400, "invalid_id", "Submission id must be a valid UUID.");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, "invalid_json", "The request body must be valid JSON.");
  }
  const parsed = submissionDecisionSchema.safeParse(body);
  if (!parsed.success) {
    const fields: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "decision");
      fields[key] ??= issue.message;
    }
    return errorResponse(400, "validation_failed", "Please fix the highlighted fields.", fields);
  }

  try {
    await decideSubmission(id, parsed.data);
    // The database function above made the decision final. Waking the paused workflow is best-effort and
    // cannot undo or change it; a run that is not woken is picked up by Resume.
    await getSubmissionRunner().resumeAfterDecision(id).catch(() => {});
    return Response.json({ submission: await getFacultySubmission(id) });
  } catch (error) {
    if (error instanceof DecisionError) {
      if (error.code === "not_found") return errorResponse(404, "not_found", error.message);
      if (error.code === "invalid") return errorResponse(400, "invalid_decision", error.message);
      return errorResponse(409, error.code, error.message);
    }
    return handleUnexpected(error);
  }
}
