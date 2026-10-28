import { describe, expect, it } from "vitest";
import type { Question } from "@/lib/schemas/assignment";
import { assembleGrading, type ModelGrading } from "./assemble";

const questions: Question[] = [
  { number: 1, text: "What does a loop do?", maxMarks: 5, rubric: "Repetition." },
  { number: 2, text: "What is an array?", maxMarks: 2.5, rubric: "Ordered values." },
];
const answerText = "1. A loop repeats a block of code\nuntil a condition stops it.\n2. An array is an ordered collection of values.";

const answer = (over: Partial<ModelGrading> = {}): ModelGrading => ({
  questions: [
    { number: 1, marks: 5, explanation: "Defines repetition.", quotes: ["A loop repeats a block of code until a condition stops it"] },
    { number: 2, marks: 2, explanation: "Mentions order.", quotes: ["an ordered collection of values"] },
  ],
  feedback: "Good start. Add an example next time.",
  ...over,
});
const run = (output: ModelGrading, text = answerText) => assembleGrading(output, { questions, answerText: text });
const issues = (output: ModelGrading, text?: string) => {
  const r = run(output, text);
  if (r.ok) throw new Error("expected issues");
  return r.issues.join(" | ");
};

describe("assembleGrading", () => {
  it("builds the recommendation with each question's maximum added by us", () => {
    const r = run(answer());
    expect(r).toMatchObject({ ok: true });
    if (!r.ok) return;
    expect(r.value.questions.map((q) => [q.number, q.marks, q.maxMarks])).toEqual([
      [1, 5, 5],
      [2, 2, 2.5],
    ]);
    expect(r.value.feedback).toBe("Good start. Add an example next time.");
  });

  it("a quote still matches when the file broke the line or changed the capital letters", () => {
    const r = run(answer({ questions: [{ ...answer().questions[0], quotes: ["a loop REPEATS a block of code until a condition stops it"] }, answer().questions[1]] }));
    expect(r.ok).toBe(true);
  });

  it("rejects a quote that is not in the student's answer", () => {
    const wrong = answer({ questions: [{ ...answer().questions[0], quotes: ["A loop is a function that sorts numbers"] }, answer().questions[1]] });
    expect(issues(wrong)).toMatch(/question 1 quotes text that is not in the student's answer/);
  });

  it("rejects marks above 0 with no quote, but allows 0 marks with none", () => {
    const noQuote = answer({ questions: [{ ...answer().questions[0], quotes: [] }, answer().questions[1]] });
    expect(issues(noQuote)).toMatch(/question 1 has marks above 0 but no quote/);
    const zero = answer({ questions: [{ number: 1, marks: 0, explanation: "Nothing relevant.", quotes: [] }, answer().questions[1]] });
    expect(run(zero).ok).toBe(true);
  });

  it("rejects a quote too short to be evidence", () => {
    const short = answer({ questions: [{ ...answer().questions[0], quotes: ["loop"] }, answer().questions[1]] });
    expect(issues(short)).toMatch(/too short/);
  });

  it("rejects marks outside 0..max, negative marks and non-numbers", () => {
    for (const marks of [5.5, -1, Number.NaN]) {
      expect(issues(answer({ questions: [{ ...answer().questions[0], marks }, answer().questions[1]] }))).toMatch(/question 1 marks must be between 0 and 5/);
    }
  });

  it("needs every question exactly once and no unknown question", () => {
    expect(issues(answer({ questions: [answer().questions[0]] }))).toMatch(/question 2 is missing/);
    expect(issues(answer({ questions: [...answer().questions, answer().questions[0]] }))).toMatch(/question 1 appears more than once/);
    expect(issues(answer({ questions: [...answer().questions, { number: 3, marks: 1, explanation: "x", quotes: [] }] }))).toMatch(/question 3 is not one of/);
  });

  it("rejects an explanation that claims the code was run", () => {
    const claims = answer({ questions: [{ ...answer().questions[0], explanation: "I ran the code and it works correctly." }, answer().questions[1]] });
    expect(issues(claims)).toMatch(/claims the code was run/);
  });

  it("rounds marks to two decimals", () => {
    const r = run(answer({ questions: [answer().questions[0], { ...answer().questions[1], marks: 1.2345 }] }));
    expect(r.ok && r.value.questions[1].marks).toBe(1.23);
  });
});
