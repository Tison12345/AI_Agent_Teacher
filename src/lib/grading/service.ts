import { GeminiError } from "@/lib/gemini/errors";
import type { Question } from "@/lib/schemas/assignment";
import type { AiResult, SubmissionStatus } from "@/lib/schemas/submission";
import { SubmissionError } from "@/lib/submissions/service";
import type { GradingPromptInput } from "./prompt";

/** Everything the marking step needs to know about one submission. */
export type GradingSubject = {
  status: SubmissionStatus;
  title: string;
  instructions: string;
  questions: Question[];
  referenceAnswers: Record<string, string> | null;
  extractedText: string | null;
};

/** The Supabase version is in repository.ts; tests use a memory one. */
export type GradingStore = {
  load(id: string): Promise<GradingSubject | null>;
  /**
   * Saves the recommendation and moves the submission to awaiting_review in one update, only if it is still
   * processing with no result yet. False when it no longer is (someone else got there first).
   */
  saveResult(id: string, result: AiResult, model: string): Promise<boolean>;
  setFailed(id: string, reason: string): Promise<void>;
};

export type GradingDeps = {
  store: GradingStore;
  generate: (input: GradingPromptInput) => Promise<AiResult>;
  model: string;
};

/** graded: a recommendation was saved. skipped: nothing to do (not processing, or no text). failed: marking failed. */
export type GradingOutcome = "graded" | "skipped" | "failed";

const GENERIC = "Marking could not be completed. Please try again.";

/** The sentence stored on a failed submission. Only our own messages are stored; raw errors are logged. */
function failureReason(error: unknown): string {
  if (error instanceof GeminiError) return `Marking could not be completed. ${error.message}`;
  console.error("[grading] unexpected error:", error instanceof Error ? `${error.name}: ${error.message.slice(0, 200)}` : "unknown");
  return GENERIC;
}

/**
 * Marks one submission with the AI and saves the result as a RECOMMENDATION awaiting faculty review.
 * It never approves or publishes anything. Only a submission that is processing, with its text read, is marked.
 * A failure keeps the submission (as "failed", with a reason and the usual Try again) instead of losing it.
 */
export async function gradeSubmission(id: string, deps: GradingDeps): Promise<GradingOutcome> {
  const subject = await deps.store.load(id);
  if (!subject) throw new SubmissionError("not_found", "Submission not found.");
  if (subject.status !== "processing" || subject.extractedText === null) return "skipped";

  let result: AiResult;
  try {
    result = await deps.generate({
      title: subject.title,
      instructions: subject.instructions,
      questions: subject.questions,
      referenceAnswers: subject.referenceAnswers,
      answerText: subject.extractedText,
    });
  } catch (error) {
    await deps.store.setFailed(id, failureReason(error));
    return "failed";
  }

  try {
    return (await deps.store.saveResult(id, result, deps.model)) ? "graded" : "skipped";
  } catch (error) {
    console.error("[grading] could not save the result:", error instanceof Error ? error.name : "unknown");
    await deps.store.setFailed(id, GENERIC);
    return "failed";
  }
}
