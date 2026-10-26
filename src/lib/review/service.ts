import type { EVALUATION_STATUSES } from "@/lib/schemas/evaluation";
import type {
  DecisionRequest,
  QueueItem,
  QuizSummary,
  ReviewDetail,
  StudentResult,
} from "@/lib/schemas/review";
import type { TeacherDecision } from "@/lib/schemas/teacher-decision";

type EvaluationStatus = (typeof EVALUATION_STATUSES)[number];

export type ReviewErrorCode = "not_found" | "already_decided" | "unchanged_edit";

const MESSAGES: Record<ReviewErrorCode, string> = {
  not_found: "Evaluation not found.",
  already_decided: "This evaluation has already been decided. A decision is final and cannot be changed.",
  unchanged_edit: "An edit must change the score or the feedback. To accept the AI's version as it is, use Approve.",
};

export class ReviewError extends Error {
  constructor(readonly code: ReviewErrorCode) {
    super(MESSAGES[code]);
    this.name = "ReviewError";
  }
}

export type NewDecision = {
  evaluationId: string;
  decision: DecisionRequest["decision"];
  approvedScore: number | null;
  approvedFeedback: string | null;
  comment: string | null;
};

export type ReviewStore = {
  list(status: EvaluationStatus | "all"): Promise<QueueItem[]>;
  getDetail(evaluationId: string): Promise<ReviewDetail | null>;
  /**
   * Saves the decision and moves the evaluation out of pending_review in one step.
   * Throws ReviewError("already_decided") if it was decided before, including by a
   * simultaneous request.
   */
  decide(decision: NewDecision): Promise<TeacherDecision>;
  /** Student-safe: only decided weeks, and only what the teacher made official. */
  listResults(projectId: string): Promise<StudentResult[]>;
};

/** The quiz state for one queue row: no quiz, a quiz nobody has taken, or the student's score. */
export function quizSummary(hasQuiz: boolean, attempt: { correctCount: number; total: number } | null): QuizSummary {
  if (attempt) return { status: "taken", correctCount: attempt.correctCount, total: attempt.total };
  return { status: hasQuiz ? "not_taken" : "not_created", correctCount: null, total: null };
}

/** The AI's next-week feedback as the text a student would read once a teacher approves it. */
export function aiFeedbackText(items: string[]): string {
  return items.length > 0 ? items.map((item) => `- ${item}`).join("\n") : "Approved by your teacher.";
}

/**
 * Applies a teacher's decision. The official score and feedback are decided here,
 * not by the browser: an approval copies the AI's suggestion exactly, so approving
 * can never smuggle in a different mark.
 */
export async function submitDecision(
  evaluationId: string,
  request: DecisionRequest,
  store: ReviewStore,
): Promise<TeacherDecision> {
  const detail = await store.getDetail(evaluationId);
  if (!detail) throw new ReviewError("not_found");
  const { evaluation } = detail;
  if (detail.decision || evaluation.status !== "pending_review") throw new ReviewError("already_decided");

  const comment = request.comment?.trim() ? request.comment.trim() : null;
  const aiFeedback = aiFeedbackText(evaluation.feedbackForNextWeek);

  if (request.decision === "approve") {
    return store.decide({
      evaluationId,
      decision: "approve",
      approvedScore: evaluation.suggestedScore,
      approvedFeedback: aiFeedback,
      comment,
    });
  }
  if (request.decision === "edit") {
    if (request.approvedScore === evaluation.suggestedScore && request.approvedFeedback === aiFeedback) {
      throw new ReviewError("unchanged_edit");
    }
    return store.decide({
      evaluationId,
      decision: "edit",
      approvedScore: request.approvedScore,
      approvedFeedback: request.approvedFeedback,
      comment,
    });
  }
  return store.decide({
    evaluationId,
    decision: "reject",
    approvedScore: null,
    approvedFeedback: null,
    comment,
  });
}
