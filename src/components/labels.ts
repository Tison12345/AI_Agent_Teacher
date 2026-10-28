import type { WeekState } from "@/lib/schemas/overview";
import type { QuizSummary } from "@/lib/schemas/review";

/** Words for where a week stands. Shared by the faculty dashboard and the project overview page. */
export const STATE_LABEL: Record<WeekState, string> = {
  not_recorded: "Not recorded",
  not_evaluated: "Recorded, not evaluated",
  pending_review: "Waiting for review",
  approved: "Approved",
  edited: "Edited",
  rejected: "Rejected",
};

/** The badge style for each state: colour plus the text label above, never colour alone. */
export const STATE_BADGE: Record<WeekState, string> = {
  not_recorded: "badge-neutral",
  not_evaluated: "badge-neutral",
  pending_review: "badge-warning",
  approved: "badge-official",
  edited: "badge-official",
  rejected: "badge-danger",
};

/** A short quiz tag for a card: "1/5", or a word when there is no result. */
export function quizTag(quiz: QuizSummary): string {
  if (quiz.status === "taken") return `${quiz.correctCount}/${quiz.total}`;
  return quiz.status === "not_taken" ? "not taken" : "not started";
}

/** The student's own quiz result: separate from the AI's score and never part of the official mark. */
export function quizText(quiz: QuizSummary): string {
  if (quiz.status === "taken") return `${quiz.correctCount}/${quiz.total} correct`;
  return quiz.status === "not_taken" ? "Created, not taken yet" : "Not started";
}
