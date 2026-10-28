import { describe, expect, it } from "vitest";
import {
  emptyQuestion,
  flattenErrors,
  unflattenErrors,
  validateAssignmentForm,
  type AssignmentFormValues,
} from "./assignment";

const valid: AssignmentFormValues = {
  title: "  Loops and arrays  ",
  instructions: "Answer every question.",
  questions: [
    { text: "What does a loop do?", maxMarks: "5", rubric: "Mentions repetition.", referenceAnswer: "  Repeats code.  " },
    { text: "What is an array?", maxMarks: "2.5", rubric: "Ordered values.", referenceAnswer: "" },
  ],
};

describe("validateAssignmentForm", () => {
  it("turns the form text into numbers, trims, and treats an empty reference answer as none", () => {
    const result = validateAssignmentForm(valid);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.title).toBe("Loops and arrays");
    expect(result.data.questions.map((q) => q.maxMarks)).toEqual([5, 2.5]);
    expect(result.data.questions[0].referenceAnswer).toBe("Repeats code.");
    expect(result.data.questions[1].referenceAnswer).toBeUndefined();
  });

  it("reports each problem against the right field and question", () => {
    const result = validateAssignmentForm({
      title: "x",
      instructions: " ",
      questions: [emptyQuestion(), { ...valid.questions[0], maxMarks: "abc" }, { ...valid.questions[0], maxMarks: "101" }],
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    const { errors } = result;
    expect(errors.title).toMatch(/at least 3/);
    expect(errors.instructions).toMatch(/required/);
    expect(errors.question?.[0]).toMatchObject({ text: expect.any(String), maxMarks: expect.any(String), rubric: expect.any(String) });
    expect(errors.question?.[1]?.maxMarks).toBeDefined();
    expect(errors.question?.[2]?.maxMarks).toMatch(/at most 100/);
    expect(errors.question?.[1]?.text).toBeUndefined();
  });

  it.each([["0"], ["-3"], ["2.555"], ["1e2000"], ["NaN"]])("rejects %s as maximum marks", (maxMarks) => {
    const result = validateAssignmentForm({ ...valid, questions: [{ ...valid.questions[0], maxMarks }] });
    expect(result.success).toBe(false);
  });

  it("accepts the limits: 1 question, 20 questions, 100 marks, 2 decimals", () => {
    const q = { ...valid.questions[0], maxMarks: "100" };
    expect(validateAssignmentForm({ ...valid, questions: [q] }).success).toBe(true);
    expect(validateAssignmentForm({ ...valid, questions: Array.from({ length: 20 }, () => ({ ...q, maxMarks: "0.25" })) }).success).toBe(true);
  });

  it("rejects no questions and more than 20", () => {
    const none = validateAssignmentForm({ ...valid, questions: [] });
    expect(none.success === false && none.errors.questions).toMatch(/at least one/);
    const many = validateAssignmentForm({ ...valid, questions: Array.from({ length: 21 }, () => valid.questions[0]) });
    expect(many.success === false && many.errors.questions).toMatch(/at most 20/);
  });
});

describe("error maps", () => {
  it("flatten and unflatten are inverses", () => {
    const errors = { title: "t", instructions: "i", questions: "q", question: { 0: { text: "a" }, 2: { maxMarks: "b", rubric: "c" } } };
    expect(unflattenErrors(flattenErrors(errors))).toEqual(errors);
  });

  it("ignores field names it does not know", () => {
    expect(unflattenErrors({ nonsense: "x", "questions.0.bad": "y" })).toEqual({});
  });
});
