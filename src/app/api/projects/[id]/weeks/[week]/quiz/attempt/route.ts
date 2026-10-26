import { errorResponse } from "@/lib/api/errors";
import { checkpointStore } from "@/lib/checkpoints/repository";
import { loadQuizTarget, quizErrorResponse } from "@/lib/quiz/http";
import { quizStore } from "@/lib/quiz/repository";
import { submitAttempt } from "@/lib/quiz/service";
import { AttemptRequestSchema, QUIZ_QUESTION_COUNT } from "@/lib/schemas/quiz";

/**
 * Grades the student's one attempt on the server and replies with the review
 * (correct answers and explanations), which is shown only from this point on.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/projects/[id]/weeks/[week]/quiz/attempt">) {
  const { id, week } = await ctx.params;
  try {
    const target = await loadQuizTarget(id, week);
    if (target instanceof Response) return target;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return errorResponse(400, "invalid_json", "Request body must be valid JSON.");
    }
    const parsed = AttemptRequestSchema.safeParse(body);
    if (!parsed.success) {
      return errorResponse(
        400,
        "invalid_answers",
        `Answer all ${QUIZ_QUESTION_COUNT} questions by choosing one option for each.`,
      );
    }

    const quiz = await submitAttempt(target, parsed.data.answers, { checkpoints: checkpointStore, quizzes: quizStore });
    return Response.json({ quiz }, { status: 201 });
  } catch (error) {
    return quizErrorResponse(error);
  }
}
