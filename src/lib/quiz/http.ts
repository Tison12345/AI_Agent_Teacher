import "server-only";
import { errorResponse, handleUnexpected } from "@/lib/api/errors";
import { loadProjectRepo } from "@/lib/github/project-repo";
import { MAX_DURATION_WEEKS } from "@/lib/validation/project";
import { QuizError, type QuizErrorCode } from "./service";

export type QuizTarget = { projectId: string; owner: string; repo: string; weekNumber: number };

/**
 * Shared by the quiz routes: checks the week, loads the project and checks the week
 * against the project's own length. Returns a ready-to-send error Response on failure.
 */
export async function loadQuizTarget(projectId: string, week: string): Promise<QuizTarget | Response> {
  const weekNumber = /^\d{1,2}$/.test(week) ? Number(week) : NaN;
  if (!(weekNumber >= 1 && weekNumber <= MAX_DURATION_WEEKS)) {
    return errorResponse(400, "invalid_week", `Week must be a whole number from 1 to ${MAX_DURATION_WEEKS}.`);
  }
  const target = await loadProjectRepo(projectId);
  if (target instanceof Response) return target;
  if (weekNumber > target.durationWeeks) {
    return errorResponse(
      400,
      "invalid_week",
      `This project lasts ${target.durationWeeks} ${target.durationWeeks === 1 ? "week" : "weeks"}, so the week must be from 1 to ${target.durationWeeks}.`,
    );
  }
  return { projectId, owner: target.owner, repo: target.repo, weekNumber };
}

const STATUS: Record<QuizErrorCode, number> = {
  checkpoint_required: 409,
  plan_required: 409,
  nothing_to_ask: 409,
  quiz_exists: 409,
  quiz_not_found: 404,
  already_attempted: 409,
};

export function quizErrorResponse(error: unknown): Response {
  if (!(error instanceof QuizError)) return handleUnexpected(error);
  return errorResponse(STATUS[error.code], error.code, error.message);
}
