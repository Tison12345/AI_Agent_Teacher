import type { Question } from "@/lib/schemas/assignment";
import type { SubmissionStatus } from "@/lib/schemas/submission";

/** Everything the marking step needs to know about one submission. */
export type GradingSubject = {
  status: SubmissionStatus;
  title: string;
  instructions: string;
  questions: Question[];
  referenceAnswers: Record<string, string> | null;
  extractedText: string | null;
};
