import { describe, expect, it } from "vitest";
import { submissionDecisionSchema } from "./submission-decision";

describe("submissionDecisionSchema", () => {
  it("approve and reject carry nothing: extra marks, feedback or totals are dropped, not trusted", () => {
    const approve = submissionDecisionSchema.parse({ decision: "approve", scores: [{ number: 1, marks: 99 }], feedback: "x", finalTotal: 100 });
    expect(approve).toEqual({ decision: "approve" });
    expect(submissionDecisionSchema.parse({ decision: "reject", finalTotal: 100 })).toEqual({ decision: "reject" });
  });

  it("an edit needs marks, feedback and a comment, trimmed", () => {
    const edit = submissionDecisionSchema.parse({
      decision: "edit",
      scores: [{ number: 1, marks: 3 }],
      feedback: "  Better.  ",
      comment: " Changed Q1. ",
    });
    expect(edit).toMatchObject({ feedback: "Better.", comment: "Changed Q1." });
    for (const missing of ["scores", "feedback", "comment"]) {
      const body: Record<string, unknown> = { decision: "edit", scores: [{ number: 1, marks: 3 }], feedback: "f", comment: "c" };
      delete body[missing];
      expect(submissionDecisionSchema.safeParse(body).success).toBe(false);
    }
    expect(submissionDecisionSchema.safeParse({ decision: "edit", scores: [{ number: 1, marks: 3 }], feedback: "  ", comment: "c" }).success).toBe(false);
  });

  it("refuses an unknown decision and out-of-range or negative marks", () => {
    expect(submissionDecisionSchema.safeParse({ decision: "publish" }).success).toBe(false);
    expect(submissionDecisionSchema.safeParse({ decision: "edit", scores: [{ number: 1, marks: -1 }], feedback: "f", comment: "c" }).success).toBe(false);
    expect(submissionDecisionSchema.safeParse({ decision: "edit", scores: [], feedback: "f", comment: "c" }).success).toBe(false);
  });
});
