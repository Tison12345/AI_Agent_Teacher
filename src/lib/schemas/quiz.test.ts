import { describe, expect, it } from "vitest";
import {
  AttemptRequestSchema,
  QuizAttemptSchema,
  QuizSchema,
  QuizViewSchema,
  type QuizQuestion,
} from "./quiz";

const uuid = "123e4567-e89b-42d3-a456-426614174000";
const uuid2 = "223e4567-e89b-42d3-a456-426614174000";
const now = "2026-10-27T10:00:00+00:00";

const question = (n: number): QuizQuestion => ({
  question: `Question ${n}?`,
  options: ["A text", "B text", "C text", "D text"],
  correctIndex: 1,
  explanation: "Because.",
});
const questions = Array.from({ length: 5 }, (_, i) => question(i + 1));

const quiz = { id: uuid, projectId: uuid2, checkpointId: uuid2, weekNumber: 2, questions, model: "m", createdAt: now };

describe("QuizSchema", () => {
  it("accepts a quiz of five questions with four options each", () => {
    expect(QuizSchema.safeParse(quiz).success).toBe(true);
  });
  it("rejects the wrong number of questions or options", () => {
    expect(QuizSchema.safeParse({ ...quiz, questions: questions.slice(1) }).success).toBe(false);
    const three = { ...questions[0], options: ["a", "b", "c"] };
    expect(QuizSchema.safeParse({ ...quiz, questions: [three, ...questions.slice(1)] }).success).toBe(false);
  });
  it("rejects a correct answer outside the options, and week 17", () => {
    const bad = { ...questions[0], correctIndex: 4 };
    expect(QuizSchema.safeParse({ ...quiz, questions: [bad, ...questions.slice(1)] }).success).toBe(false);
    expect(QuizSchema.safeParse({ ...quiz, weekNumber: 17 }).success).toBe(false);
  });
});

describe("QuizAttemptSchema", () => {
  const attempt = { id: uuid, quizId: uuid2, answers: [0, 1, 2, 3, 1], correctCount: 2, total: 5, submittedAt: now };
  it("accepts a valid attempt", () => {
    expect(QuizAttemptSchema.safeParse(attempt).success).toBe(true);
  });
  it("rejects a score above the total and answers out of range", () => {
    expect(QuizAttemptSchema.safeParse({ ...attempt, correctCount: 6 }).success).toBe(false);
    expect(QuizAttemptSchema.safeParse({ ...attempt, answers: [0, 1, 2, 3, 4] }).success).toBe(false);
  });
});

describe("AttemptRequestSchema", () => {
  it("accepts exactly five answers from 0 to 3", () => {
    expect(AttemptRequestSchema.safeParse({ answers: [0, 1, 2, 3, 0] }).success).toBe(true);
  });
  it.each([
    [{ answers: [0, 1, 2, 3] }],
    [{ answers: [0, 1, 2, 3, 0, 1] }],
    [{ answers: [0, 1, 2, 3, 4] }],
    [{ answers: [0, 1, 2, 3, -1] }],
    [{ answers: [0, 1, 2, 3, 1.5] }],
    [{ answers: [0, 1, 2, 3, "1"] }],
    [{ answers: [0, 1, 2, 3, null] }],
    [{}],
    [{ answers: [0, 1, 2, 3, 0], score: 5 }], // nothing but the answers: a student cannot send their own score
    [{ answers: [0, 1, 2, 3, 0], correctCount: 5 }],
  ])("rejects %j", (body) => {
    expect(AttemptRequestSchema.safeParse(body).success).toBe(false);
  });
});

describe("QuizViewSchema", () => {
  const open = {
    state: "open",
    quizId: uuid,
    weekNumber: 1,
    questions: questions.map((q) => ({ question: q.question, options: q.options })),
  };
  it("accepts an open quiz that has no answers", () => {
    expect(QuizViewSchema.safeParse(open).success).toBe(true);
  });
  it("accepts a taken quiz with the review, and rejects one that lacks it", () => {
    const taken = {
      state: "taken",
      quizId: uuid,
      weekNumber: 1,
      correctCount: 3,
      total: 5,
      submittedAt: now,
      questions: questions.map((q) => ({ ...q, chosenIndex: 0 })),
    };
    expect(QuizViewSchema.safeParse(taken).success).toBe(true);
    expect(QuizViewSchema.safeParse({ ...taken, questions: open.questions }).success).toBe(false);
  });
});
