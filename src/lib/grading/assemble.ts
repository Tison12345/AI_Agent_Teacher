import { z } from "zod";
import { claimsExecution } from "@/lib/evaluation/assemble";
import type { Question } from "@/lib/schemas/assignment";
import type { AiResult } from "@/lib/schemas/submission";

const text = (max: number) => z.string().trim().min(1).max(max);

/** What the model is asked to return. Totals and maximum marks are added by our code. */
export const ModelGradingSchema = z.object({
  questions: z.array(
    z.object({
      number: z.number().int(),
      marks: z.number(),
      explanation: text(700),
      quotes: z.array(text(400)).max(3),
    }),
  ),
  feedback: text(1500),
});

export type ModelGrading = z.infer<typeof ModelGradingSchema>;

export type AssembleGradingResult = { ok: true; value: AiResult } | { ok: false; issues: string[] };

/** A quote must be at least this long, so "a" or "0" cannot "prove" an answer. */
const MIN_QUOTE_CHARS = 8;

const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Checks the model's answer against the assignment and the student's real text, then builds the stored
 * recommendation. Returns the problems when anything does not hold, so the caller can ask for a corrected
 * answer instead of saving bad data. Marks are never awarded without a quote that really is in the answer.
 */
export function assembleGrading(output: ModelGrading, context: { questions: Question[]; answerText: string }): AssembleGradingResult {
  const { questions, answerText } = context;
  const issues: string[] = [];
  const haystack = norm(answerText);

  const byNumber = new Map<number, ModelGrading["questions"][number]>();
  for (const item of output.questions) {
    if (byNumber.has(item.number)) issues.push(`question ${item.number} appears more than once`);
    byNumber.set(item.number, item);
  }
  const known = new Set(questions.map((q) => q.number));
  for (const item of output.questions) {
    if (!known.has(item.number)) issues.push(`question ${item.number} is not one of the assignment's questions`);
  }

  const graded: AiResult["questions"] = [];
  for (const question of questions) {
    const item = byNumber.get(question.number);
    if (!item) {
      issues.push(`question ${question.number} is missing`);
      continue;
    }
    const label = `question ${question.number}`;
    if (!Number.isFinite(item.marks) || item.marks < 0 || item.marks > question.maxMarks) {
      issues.push(`${label} marks must be between 0 and ${question.maxMarks}`);
    }
    if (item.marks > 0 && item.quotes.length === 0) {
      issues.push(`${label} has marks above 0 but no quote from the student's answer; give 0 if the answer does not support them`);
    }
    for (const quote of item.quotes) {
      const q = norm(quote);
      if (q.length < MIN_QUOTE_CHARS) {
        issues.push(`${label} has a quote that is too short to be evidence`);
      } else if (!haystack.includes(q)) {
        issues.push(`${label} quotes text that is not in the student's answer: "${quote.slice(0, 60)}"`);
      }
    }
    if (claimsExecution(item.explanation)) {
      issues.push(`${label} claims the code was run or tested, which did not happen; describe only what the answer says`);
    }
    graded.push({
      number: question.number,
      marks: round2(Math.min(Math.max(item.marks, 0), question.maxMarks)),
      maxMarks: question.maxMarks,
      explanation: item.explanation,
      quotes: item.quotes,
    });
  }

  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, value: { questions: graded, feedback: output.feedback, notes: [] } };
}
