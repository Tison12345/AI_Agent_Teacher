import { errorResponse } from "@/lib/api/errors";
import { quizErrorResponse } from "@/lib/quiz/http";
import { quizStore } from "@/lib/quiz/repository";
import { toView } from "@/lib/quiz/service";
import { invalidIdResponse } from "@/lib/review/http";
import { reviewStore } from "@/lib/review/repository";

/**
 * The student's quiz result for the week an evaluation covers, shown next to the AI's
 * recommendation as separate evidence. Teachers only once login exists. While the quiz
 * is still open the answers are withheld, as they are for students.
 */
export async function GET(_request: Request, ctx: RouteContext<"/api/faculty/evaluations/[id]/quiz">) {
  const { id } = await ctx.params;
  const invalid = invalidIdResponse(id, "Evaluation");
  if (invalid) return invalid;
  try {
    const detail = await reviewStore.getDetail(id);
    if (!detail) return errorResponse(404, "not_found", "Evaluation not found.");
    const stored = await quizStore.getByCheckpoint(detail.evaluation.checkpointId);
    return Response.json({ quiz: stored ? toView(stored) : null });
  } catch (error) {
    return quizErrorResponse(error);
  }
}
