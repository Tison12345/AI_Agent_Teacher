import { randomInt } from "node:crypto";
import { z } from "zod";
import {
  QUIZ_OPTION_COUNT,
  QUIZ_QUESTION_COUNT,
  QuizQuestionSchema,
  type QuizQuestion,
} from "@/lib/schemas/quiz";

/** What Gemini returns. Its limits are enforced by QuizQuestionSchema below, not sent to Gemini. */
export const ModelQuizSchema = z.object({
  questions: z.array(
    z.object({
      question: z.string(),
      options: z.array(z.string()),
      correctIndex: z.number(),
      explanation: z.string(),
    }),
  ),
});
export type ModelQuiz = z.infer<typeof ModelQuizSchema>;

// Options that only make sense in a fixed order break when the options are shuffled.
const POSITIONAL_OPTION =
  /\b(all|none|both|neither) of (the )?(above|these|those|options|answers)\b|\b(option|choice|answer)s? [a-d]\b|\b[a-d] (and|or) [a-d]\b|\ball answers\b/i;

const normalize = (value: string) => value.trim().replace(/\s+/g, " ").toLowerCase();

export type RandomInt = (maxExclusive: number) => number;

/** Fisher-Yates shuffle with an injectable random source (so tests can be deterministic). */
export function shuffleOptions(question: QuizQuestion, random: RandomInt = (n) => randomInt(n)): QuizQuestion {
  const order = question.options.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = random(i + 1);
    [order[i], order[j]] = [order[j], order[i]];
  }
  return {
    ...question,
    options: order.map((original) => question.options[original]),
    correctIndex: order.indexOf(question.correctIndex),
  };
}

export type AssembledQuiz = { ok: true; value: QuizQuestion[] } | { ok: false; issues: string[] };

/**
 * Checks the model's questions against our own rules and shuffles the options so the
 * position of the correct answer is decided by the server, not by the model.
 * Anything wrong is reported, never repaired: the caller asks the model again.
 */
export function assembleQuiz(model: ModelQuiz, random?: RandomInt): AssembledQuiz {
  const issues: string[] = [];

  if (model.questions.length !== QUIZ_QUESTION_COUNT) {
    issues.push(`Write exactly ${QUIZ_QUESTION_COUNT} questions (you wrote ${model.questions.length}).`);
  }

  const questions: QuizQuestion[] = [];
  const seenQuestions = new Set<string>();
  model.questions.forEach((raw, index) => {
    const label = `Question ${index + 1}`;
    const parsed = QuizQuestionSchema.safeParse({
      ...raw,
      question: raw.question.trim(),
      options: raw.options.map((o) => o.trim()),
      explanation: raw.explanation.trim(),
    });
    if (!parsed.success) {
      if (raw.options.length !== QUIZ_OPTION_COUNT) {
        issues.push(`${label} must have exactly ${QUIZ_OPTION_COUNT} options.`);
      } else if (!Number.isInteger(raw.correctIndex) || raw.correctIndex < 0 || raw.correctIndex >= QUIZ_OPTION_COUNT) {
        issues.push(`${label}: correctIndex must be a whole number from 0 to ${QUIZ_OPTION_COUNT - 1}.`);
      } else {
        issues.push(`${label} has an empty or too-long question, option or explanation.`);
      }
      return;
    }
    const q = parsed.data;
    const key = normalize(q.question);
    if (seenQuestions.has(key)) issues.push(`${label} repeats an earlier question.`);
    seenQuestions.add(key);
    if (new Set(q.options.map(normalize)).size !== q.options.length) {
      issues.push(`${label} has two options that are the same.`);
    }
    if (q.options.some((o) => POSITIONAL_OPTION.test(o))) {
      issues.push(`${label} has an option such as "all of the above" or one that refers to another option. Remove it.`);
    }
    questions.push(q);
  });

  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, value: questions.map((q) => shuffleOptions(q, random)) };
}
