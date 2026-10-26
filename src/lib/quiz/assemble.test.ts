import { describe, expect, it } from "vitest";
import type { QuizQuestion } from "@/lib/schemas/quiz";
import { assembleQuiz, shuffleOptions } from "./assemble";
import { modelQuiz } from "./fixtures";

const base: QuizQuestion = {
  question: "What does the loop do?",
  options: ["one", "two", "three", "four"],
  correctIndex: 2,
  explanation: "Because.",
};

describe("shuffleOptions", () => {
  it("keeps the same options and tracks where the correct one moved", () => {
    for (let seed = 0; seed < 50; seed++) {
      let s = seed;
      const random = (n: number) => (s = (s * 7 + 3) % 1000) % n; // a simple repeatable sequence
      const shuffled = shuffleOptions(base, random);
      expect([...shuffled.options].sort()).toEqual([...base.options].sort());
      expect(shuffled.options[shuffled.correctIndex]).toBe("three");
    }
  });

  it("really moves the correct answer around (it is not always in the same place)", () => {
    const positions = new Set<number>();
    for (let i = 0; i < 200; i++) positions.add(shuffleOptions(base).correctIndex);
    expect(positions.size).toBe(4);
  });
});

describe("assembleQuiz", () => {
  it("accepts a valid quiz and keeps each correct answer pointing at the right option", () => {
    const result = assembleQuiz(modelQuiz());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(5);
    result.value.forEach((q, i) => expect(q.options[q.correctIndex]).toBe(`Right answer ${i + 1}`));
  });

  it("does not leave the correct answer in the model's chosen position", () => {
    // The model put every right answer first; the server decides the position.
    const positions = new Set<number>();
    for (let i = 0; i < 40; i++) {
      const result = assembleQuiz(modelQuiz());
      if (result.ok) result.value.forEach((q) => positions.add(q.correctIndex));
    }
    expect(positions.size).toBeGreaterThan(1);
  });

  it("trims whitespace", () => {
    const quiz = modelQuiz();
    quiz.questions[0].question = "  Padded question?  ";
    quiz.questions[0].options[1] = "  Padded option  ";
    const result = assembleQuiz(quiz);
    expect(result.ok && result.value[0].question).toBe("Padded question?");
    expect(result.ok && result.value[0].options).toContain("Padded option");
  });

  it.each([
    ["four questions", (q: ReturnType<typeof modelQuiz>) => ({ ...q, questions: q.questions.slice(1) }), /exactly 5/],
    ["six questions", (q: ReturnType<typeof modelQuiz>) => ({ ...q, questions: [...q.questions, q.questions[0]] }), /exactly 5/],
  ])("rejects %s", (_name, change, issue) => {
    const result = assembleQuiz(change(modelQuiz()));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.join(" ")).toMatch(issue);
  });

  function withQuestion(change: (q: ReturnType<typeof modelQuiz>["questions"][number]) => void) {
    const quiz = modelQuiz();
    change(quiz.questions[2]);
    return assembleQuiz(quiz);
  }

  it("rejects the wrong number of options, naming the question", () => {
    const result = withQuestion((q) => (q.options = ["a", "b", "c"]));
    expect(result).toMatchObject({ ok: false });
    expect(!result.ok && result.issues[0]).toMatch(/Question 3 must have exactly 4 options/);
  });

  it.each([-1, 4, 1.5, Number.NaN])("rejects correctIndex %s", (correctIndex) => {
    const result = withQuestion((q) => (q.correctIndex = correctIndex));
    expect(result.ok).toBe(false);
    expect(!result.ok && result.issues[0]).toMatch(/correctIndex/);
  });

  it("rejects empty text", () => {
    expect(withQuestion((q) => (q.explanation = "   ")).ok).toBe(false);
    expect(withQuestion((q) => (q.options[0] = "")).ok).toBe(false);
  });

  it("rejects duplicate options, ignoring case and spacing", () => {
    const result = withQuestion((q) => (q.options[1] = " RIGHT   answer 3 "));
    expect(result.ok).toBe(false);
    expect(!result.ok && result.issues.join(" ")).toMatch(/two options that are the same/);
  });

  it("rejects a repeated question", () => {
    const quiz = modelQuiz();
    quiz.questions[4].question = quiz.questions[0].question.toUpperCase();
    const result = assembleQuiz(quiz);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.issues.join(" ")).toMatch(/repeats an earlier question/);
  });

  it.each([
    "All of the above",
    "None of the above",
    "Both A and B",
    "Both of the above",
    "Option C is correct",
    "A and C",
    "Neither of these options",
  ])("rejects the position-dependent option %j", (text) => {
    const result = withQuestion((q) => (q.options[3] = text));
    expect(result.ok).toBe(false);
    expect(!result.ok && result.issues.join(" ")).toMatch(/all of the above|refers to another option/);
  });

  it("allows ordinary options that merely contain letters or the word 'above'", () => {
    const result = withQuestion((q) => {
      q.options[1] = "It runs the code above the loop";
      q.options[2] = "It stores a value in variable a";
    });
    expect(result.ok).toBe(true);
  });
});
