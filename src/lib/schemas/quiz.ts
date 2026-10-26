import { z } from "zod";
import { MAX_DURATION_WEEKS } from "@/lib/validation/project";

export const QUIZ_QUESTION_COUNT = 5;
export const QUIZ_OPTION_COUNT = 4;

const text = (max: number) => z.string().trim().min(1).max(max);

/** One multiple-choice question as stored. The correct answer never leaves the server before an attempt. */
export const QuizQuestionSchema = z.object({
  question: text(300),
  options: z.array(text(200)).length(QUIZ_OPTION_COUNT),
  correctIndex: z.number().int().min(0).max(QUIZ_OPTION_COUNT - 1),
  explanation: text(400),
});

export const QuizSchema = z.object({
  id: z.uuid(),
  projectId: z.uuid(),
  checkpointId: z.uuid(),
  weekNumber: z.number().int().min(1).max(MAX_DURATION_WEEKS),
  questions: z.array(QuizQuestionSchema).length(QUIZ_QUESTION_COUNT),
  model: text(200),
  createdAt: z.iso.datetime({ offset: true }),
});

export const QuizAttemptSchema = z
  .object({
    id: z.uuid(),
    quizId: z.uuid(),
    answers: z.array(z.number().int().min(0).max(QUIZ_OPTION_COUNT - 1)).length(QUIZ_QUESTION_COUNT),
    correctCount: z.number().int().min(0),
    total: z.number().int().positive(),
    submittedAt: z.iso.datetime({ offset: true }),
  })
  .refine((a) => a.correctCount <= a.total, "correctCount must not exceed total");

/** What a student sends: one chosen option per question. Nothing else is accepted. */
export const AttemptRequestSchema = z.strictObject({
  answers: z.array(z.number().int().min(0).max(QUIZ_OPTION_COUNT - 1)).length(QUIZ_QUESTION_COUNT),
});

const PublicQuestionSchema = z.object({
  question: z.string(),
  options: z.array(z.string()).length(QUIZ_OPTION_COUNT),
});

const ReviewedQuestionSchema = PublicQuestionSchema.extend({
  correctIndex: z.number().int().min(0).max(QUIZ_OPTION_COUNT - 1),
  explanation: z.string(),
  chosenIndex: z.number().int().min(0).max(QUIZ_OPTION_COUNT - 1),
});

/**
 * What the browser receives. Before an attempt there are no correct answers or explanations
 * in the data at all; after the one attempt, the full review.
 */
export const QuizViewSchema = z.discriminatedUnion("state", [
  z.object({
    state: z.literal("open"),
    quizId: z.uuid(),
    weekNumber: z.number().int(),
    questions: z.array(PublicQuestionSchema).length(QUIZ_QUESTION_COUNT),
  }),
  z.object({
    state: z.literal("taken"),
    quizId: z.uuid(),
    weekNumber: z.number().int(),
    questions: z.array(ReviewedQuestionSchema).length(QUIZ_QUESTION_COUNT),
    correctCount: z.number().int().min(0),
    total: z.number().int().positive(),
    submittedAt: z.iso.datetime({ offset: true }),
  }),
]);

export type QuizQuestion = z.infer<typeof QuizQuestionSchema>;
export type Quiz = z.infer<typeof QuizSchema>;
export type QuizAttempt = z.infer<typeof QuizAttemptSchema>;
export type QuizView = z.infer<typeof QuizViewSchema>;
