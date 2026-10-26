import { checkpointStore } from "@/lib/checkpoints/repository";
import { getGeminiClient, getGeminiModel } from "@/lib/gemini/client";
import { getGitHubClient } from "@/lib/github/client";
import { getPlan } from "@/lib/plans/repository";
import { loadQuizTarget, quizErrorResponse } from "@/lib/quiz/http";
import { quizStore } from "@/lib/quiz/repository";
import { generateQuiz, getQuizView } from "@/lib/quiz/service";

// Fetching the diff and asking Gemini can take a while.
export const maxDuration = 60;

/**
 * The week's quiz as a student may see it: questions and options only. Correct answers
 * and explanations appear only after the one attempt has been submitted.
 */
export async function GET(_request: Request, ctx: RouteContext<"/api/projects/[id]/weeks/[week]/quiz">) {
  const { id, week } = await ctx.params;
  try {
    const target = await loadQuizTarget(id, week);
    if (target instanceof Response) return target;
    const quiz = await getQuizView(id, target.weekNumber, { checkpoints: checkpointStore, quizzes: quizStore });
    return Response.json({ quiz });
  } catch (error) {
    return quizErrorResponse(error);
  }
}

/** Creates the quiz for a recorded week (once). */
export async function POST(_request: Request, ctx: RouteContext<"/api/projects/[id]/weeks/[week]/quiz">) {
  const { id, week } = await ctx.params;
  try {
    const target = await loadQuizTarget(id, week);
    if (target instanceof Response) return target;

    // Fail fast, before any GitHub or Gemini work, if Gemini is not configured.
    const client = getGeminiClient();
    const quiz = await generateQuiz(target, {
      checkpoints: checkpointStore,
      quizzes: quizStore,
      getPlan,
      github: getGitHubClient(),
      gemini: { client, model: getGeminiModel() },
    });
    return Response.json({ quiz }, { status: 201 });
  } catch (error) {
    return quizErrorResponse(error);
  }
}
