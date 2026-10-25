import { errorResponse } from "@/lib/api/errors";
import { invalidIdResponse, reviewErrorResponse } from "@/lib/review/http";
import { reviewStore } from "@/lib/review/repository";

/** One evaluation with the diff the AI was shown. Teachers only once login exists. */
export async function GET(_request: Request, ctx: RouteContext<"/api/faculty/evaluations/[id]">) {
  const { id } = await ctx.params;
  const invalid = invalidIdResponse(id, "Evaluation");
  if (invalid) return invalid;
  try {
    const detail = await reviewStore.getDetail(id);
    if (!detail) return errorResponse(404, "not_found", "Evaluation not found.");
    return Response.json(detail);
  } catch (error) {
    return reviewErrorResponse(error);
  }
}
