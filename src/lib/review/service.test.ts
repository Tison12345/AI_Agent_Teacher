import { describe, expect, it } from "vitest";
import { DecisionRequestSchema } from "@/lib/schemas/review";
import { reviewWorld } from "@/test/review-fixtures";
import { aiFeedbackText, quizSummary, ReviewError, submitDecision } from "./service";

const parse = (body: unknown) => DecisionRequestSchema.parse(body);

describe("quizSummary", () => {
  it("is not_created without a quiz, not_taken with one nobody has attempted, and the score once taken", () => {
    expect(quizSummary(false, null)).toEqual({ status: "not_created", correctCount: null, total: null });
    expect(quizSummary(true, null)).toEqual({ status: "not_taken", correctCount: null, total: null });
    expect(quizSummary(true, { correctCount: 0, total: 5 })).toEqual({ status: "taken", correctCount: 0, total: 5 });
  });
});

describe("submitDecision", () => {
  it("approve copies the AI's score and feedback exactly and marks the evaluation approved", async () => {
    const { review, seed } = reviewWorld();
    const { evaluation } = await seed();
    const decision = await submitDecision(evaluation.id, parse({ decision: "approve" }), review.store);
    expect(decision).toMatchObject({
      evaluationId: evaluation.id,
      decision: "approve",
      approvedScore: evaluation.suggestedScore,
      approvedFeedback: aiFeedbackText(evaluation.feedbackForNextWeek),
      comment: null,
    });
    expect((await review.store.getDetail(evaluation.id))?.evaluation.status).toBe("approved");
  });

  it("an approval cannot carry its own score or feedback", () => {
    expect(DecisionRequestSchema.safeParse({ decision: "approve", approvedScore: 100 }).success).toBe(false);
    expect(DecisionRequestSchema.safeParse({ decision: "approve", approvedFeedback: "x" }).success).toBe(false);
  });

  it("edit stores the teacher's own score and feedback, and the AI's suggestion stays untouched", async () => {
    const { review, seed } = reviewWorld();
    const { evaluation } = await seed(1, [36, 30, 28]);
    const decision = await submitDecision(
      evaluation.id,
      parse({ decision: "edit", approvedScore: 71.5, approvedFeedback: "Good start. Add validation.", comment: "AI missed the empty-title bug." }),
      review.store,
    );
    expect(decision).toMatchObject({ decision: "edit", approvedScore: 71.5, approvedFeedback: "Good start. Add validation." });
    const detail = await review.store.getDetail(evaluation.id);
    expect(detail?.evaluation.status).toBe("edited");
    expect(detail?.evaluation.suggestedScore).toBe(94); // the recommendation is kept as evidence
  });

  it("an edit that changes nothing is refused, so approvals stay honest", async () => {
    const { review, seed } = reviewWorld();
    const { evaluation } = await seed();
    const same = parse({
      decision: "edit",
      approvedScore: evaluation.suggestedScore,
      approvedFeedback: aiFeedbackText(evaluation.feedbackForNextWeek),
      comment: "no change",
    });
    await expect(submitDecision(evaluation.id, same, review.store)).rejects.toMatchObject({ code: "unchanged_edit" });
    expect((await review.store.getDetail(evaluation.id))?.evaluation.status).toBe("pending_review");
  });

  it("reject stores no score and no feedback", async () => {
    const { review, seed } = reviewWorld();
    const { evaluation } = await seed();
    const decision = await submitDecision(
      evaluation.id,
      parse({ decision: "reject", comment: "The AI could not read the main files." }),
      review.store,
    );
    expect(decision).toMatchObject({ decision: "reject", approvedScore: null, approvedFeedback: null });
    expect((await review.store.getDetail(evaluation.id))?.evaluation.status).toBe("rejected");
  });

  it("a decision is final: deciding again fails and changes nothing", async () => {
    const { review, seed } = reviewWorld();
    const { evaluation } = await seed();
    await submitDecision(evaluation.id, parse({ decision: "approve" }), review.store);
    await expect(
      submitDecision(evaluation.id, parse({ decision: "reject", comment: "changed my mind" }), review.store),
    ).rejects.toMatchObject({ code: "already_decided" });
    expect(review.decisions).toHaveLength(1);
    expect(review.decisions[0].decision).toBe("approve");
  });

  it("simultaneous decisions record exactly one", async () => {
    const { review, seed } = reviewWorld();
    const { evaluation } = await seed();
    const results = await Promise.allSettled([
      submitDecision(evaluation.id, parse({ decision: "approve" }), review.store),
      submitDecision(evaluation.id, parse({ decision: "reject", comment: "no" }), review.store),
      submitDecision(evaluation.id, parse({ decision: "edit", approvedScore: 50, approvedFeedback: "x", comment: "y" }), review.store),
      submitDecision(evaluation.id, parse({ decision: "approve" }), review.store),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    for (const r of results.filter((r) => r.status === "rejected")) {
      expect((r as PromiseRejectedResult).reason).toBeInstanceOf(ReviewError);
      expect((r as PromiseRejectedResult).reason.code).toBe("already_decided");
    }
    expect(review.decisions).toHaveLength(1);
  });

  it("an unknown evaluation is not found", async () => {
    const { review } = reviewWorld();
    await expect(
      submitDecision("00000000-0000-4000-8000-00000000dead", parse({ decision: "approve" }), review.store),
    ).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("DecisionRequestSchema", () => {
  it.each([
    ["no decision", {}],
    ["unknown decision", { decision: "maybe" }],
    ["edit without a comment", { decision: "edit", approvedScore: 50, approvedFeedback: "x" }],
    ["edit with a blank comment", { decision: "edit", approvedScore: 50, approvedFeedback: "x", comment: "  " }],
    ["edit without feedback", { decision: "edit", approvedScore: 50, comment: "c" }],
    ["edit with blank feedback", { decision: "edit", approvedScore: 50, approvedFeedback: " ", comment: "c" }],
    ["score above 100", { decision: "edit", approvedScore: 100.1, approvedFeedback: "x", comment: "c" }],
    ["negative score", { decision: "edit", approvedScore: -1, approvedFeedback: "x", comment: "c" }],
    ["score as a string", { decision: "edit", approvedScore: "80", approvedFeedback: "x", comment: "c" }],
    ["score with too many decimals", { decision: "edit", approvedScore: 80.123, approvedFeedback: "x", comment: "c" }],
    ["score NaN", { decision: "edit", approvedScore: Number.NaN, approvedFeedback: "x", comment: "c" }],
    ["reject without a comment", { decision: "reject" }],
    ["reject carrying a score", { decision: "reject", comment: "c", approvedScore: 10 }],
    ["unknown extra field", { decision: "approve", status: "approved" }],
    ["over-long comment", { decision: "reject", comment: "x".repeat(1001) }],
    ["over-long feedback", { decision: "edit", approvedScore: 50, approvedFeedback: "x".repeat(3001), comment: "c" }],
  ])("rejects %s", (_label, body) => {
    expect(DecisionRequestSchema.safeParse(body).success).toBe(false);
  });

  it.each([0, 100, 0.5, 72.3])("accepts score %s", (approvedScore) => {
    expect(DecisionRequestSchema.safeParse({ decision: "edit", approvedScore, approvedFeedback: "x", comment: "c" }).success).toBe(true);
  });
});

describe("student results", () => {
  it("lists only decided weeks, with official values and nothing from the AI", async () => {
    const { review, seed } = reviewWorld();
    const week1 = await seed(1);
    const week2 = await seed(2, [20, 10, 5]);
    await seed(3); // still pending
    await submitDecision(week1.evaluation.id, parse({ decision: "approve", comment: "internal note" }), review.store);
    await submitDecision(
      week2.evaluation.id,
      parse({ decision: "edit", approvedScore: 40, approvedFeedback: "Needs persistence.", comment: "AI too harsh" }),
      review.store,
    );
    const results = await review.store.listResults("123e4567-e89b-42d3-a456-426614174000");
    expect(results.map((r) => [r.weekNumber, r.outcome, r.officialScore])).toEqual([
      [1, "approved", 94],
      [2, "edited", 40],
    ]);
    const text = JSON.stringify(results);
    expect(text).not.toMatch(/internal note|AI too harsh|suggested|confidence|criteri/i);
  });

  it("does not leak another project's results", async () => {
    const { review, seed } = reviewWorld();
    const other = await seed(1, [36, 30, 28], "223e4567-e89b-42d3-a456-426614174000");
    await submitDecision(other.evaluation.id, parse({ decision: "approve" }), review.store);
    expect(await review.store.listResults("123e4567-e89b-42d3-a456-426614174000")).toEqual([]);
  });
});
