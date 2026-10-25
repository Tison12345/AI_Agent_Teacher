import { errorResponse } from "@/lib/api/errors";
import { getProject } from "@/lib/projects/repository";
import { invalidIdResponse, reviewErrorResponse } from "@/lib/review/http";
import { reviewStore } from "@/lib/review/repository";

/**
 * What a student may see: only weeks a teacher has decided, with the official score
 * and feedback the teacher approved. Never the AI's score, the AI's own feedback or
 * the teacher's private comment.
 */
export async function GET(_request: Request, ctx: RouteContext<"/api/projects/[id]/results">) {
  const { id } = await ctx.params;
  const invalid = invalidIdResponse(id, "Project");
  if (invalid) return invalid;
  try {
    if (!(await getProject(id))) return errorResponse(404, "not_found", "Project not found.");
    return Response.json({ results: await reviewStore.listResults(id) });
  } catch (error) {
    return reviewErrorResponse(error);
  }
}
