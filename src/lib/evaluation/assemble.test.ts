import { describe, expect, it } from "vitest";
import { assembleEvaluation, buildReviewScope } from "./assemble";
import {
  INJECTION,
  NOTHING_READABLE,
  PARTIAL,
  STRONG,
  UNREADABLE,
  WEEK,
  modelAnswer,
} from "./fixtures";

const ctx = (snapshot = STRONG) => ({ criteria: WEEK.evaluationCriteria, snapshot });
const issuesOf = (result: ReturnType<typeof assembleEvaluation>) => (result.ok ? [] : result.issues);

describe("expected evaluation cases", () => {
  it("strong week: scores add up to the suggested total, with evidence", () => {
    const result = assembleEvaluation(modelAnswer([36, 30, 28]), ctx(STRONG));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.suggestedScore).toBe(94); // (36+30+28) / 100
    expect(result.value.criteriaAssessments.map((a) => a.criterion)).toEqual(["Add a book", "Show the list", "Keep the data"]);
    expect(result.value.criteriaAssessments.map((a) => a.maxScore)).toEqual([40, 30, 30]);
    expect(result.value.criteriaAssessments.every((a) => a.evidence.length > 0)).toBe(true);
    expect(result.value.confidence.level).toBe("high");
  });

  it("partial week: no persistence in the diff, so that criterion gets 0 and a lower total", () => {
    const answer = modelAnswer([34, 26, 0], {
      incompleteRequirements: ["Keeping the books after the page reloads: nothing in the changes saves them."],
      confidence: { level: "high", uncertainties: [] },
    });
    const result = assembleEvaluation(answer, ctx(PARTIAL));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.suggestedScore).toBe(60);
    expect(result.value.criteriaAssessments[2]).toMatchObject({ criterion: "Keep the data", score: 0, evidence: [] });
    expect(result.value.incompleteRequirements[0]).toMatch(/reloads/);
  });

  it("the total is computed here, whatever the model says about it", () => {
    const answer = { ...modelAnswer([10, 10, 10]), suggestedScore: 100, total: 100 } as never;
    const result = assembleEvaluation(answer, ctx(STRONG));
    expect(result.ok && result.value.suggestedScore).toBe(30);
  });

  it("an all-zero answer is allowed (nothing earned) and totals 0", () => {
    const result = assembleEvaluation(modelAnswer([0, 0, 0]), ctx(STRONG));
    expect(result.ok && result.value.suggestedScore).toBe(0);
  });

  it("criteria may come back in any order; they are stored in plan order", () => {
    const answer = modelAnswer([36, 30, 28]);
    answer.criteria.reverse();
    const result = assembleEvaluation(answer, ctx(STRONG));
    expect(result.ok && result.value.criteriaAssessments.map((a) => a.criterion)).toEqual(["Add a book", "Show the list", "Keep the data"]);
  });

  it("matches criterion names ignoring case and extra spaces", () => {
    const answer = modelAnswer([36, 30, 28]);
    answer.criteria[0].name = "  add   a BOOK ";
    expect(assembleEvaluation(answer, ctx(STRONG)).ok).toBe(true);
  });
});

describe("answers that must be rejected", () => {
  it("rejects a missing, extra or duplicated criterion", () => {
    const missing = modelAnswer([36, 30, 28]);
    missing.criteria.pop();
    expect(issuesOf(assembleEvaluation(missing, ctx())).join(" ")).toMatch(/"Keep the data" is missing/);

    const extra = modelAnswer([36, 30, 28]);
    extra.criteria.push({ name: "Bonus points", score: 10, rationale: "x", evidence: [{ filePath: "src/app.js", observation: "y" }] });
    expect(issuesOf(assembleEvaluation(extra, ctx())).join(" ")).toMatch(/"Bonus points" is not one of the week's criteria/);

    const dup = modelAnswer([36, 30, 28]);
    dup.criteria.push({ ...dup.criteria[0] });
    expect(issuesOf(assembleEvaluation(dup, ctx())).join(" ")).toMatch(/more than once/);
  });

  it.each([[41], [-1], [Number.NaN], [Number.POSITIVE_INFINITY]])("rejects a score of %s above the criterion's maximum or invalid", (score) => {
    const answer = modelAnswer([36, 30, 28]);
    answer.criteria[0].score = score;
    expect(issuesOf(assembleEvaluation(answer, ctx())).join(" ")).toMatch(/score must be between 0 and 40/);
  });

  it("rejects points with no evidence", () => {
    const answer = modelAnswer([36, 30, 28]);
    answer.criteria[1].evidence = [];
    expect(issuesOf(assembleEvaluation(answer, ctx())).join(" ")).toMatch(/"Show the list" has a score above 0 but no evidence/);
  });

  it("rejects evidence that cites a file that is not in the changes (hallucination)", () => {
    const answer = modelAnswer([36, 30, 28], {}, "src/database.py");
    const text = issuesOf(assembleEvaluation(answer, ctx())).join(" ");
    expect(text).toMatch(/src\/database\.py/);
    expect(text).toMatch(/not a file whose contents were provided/);
  });

  it("rejects evidence from files whose contents the AI never saw", () => {
    const answer = modelAnswer([36, 30, 28], {}, "src/big.js"); // present in the diff, but contents unavailable
    expect(assembleEvaluation(answer, ctx(UNREADABLE)).ok).toBe(false);
    const deleted = modelAnswer([36, 30, 28], {}, "src/old.js");
    expect(assembleEvaluation(deleted, ctx(UNREADABLE)).ok).toBe(false);
  });

  it.each([
    "The program runs correctly and all tests pass.",
    "I ran the code and it works as expected.",
    "Tests passed after the change.",
    "The code compiles and the build passes.",
    "The app works perfectly.",
    "It successfully runs without errors.",
    "The code adds a form, but the tests pass.",
    "Everything is fine. Tests pass.",
  ])("rejects a claim of running or testing the code: %j", (claim) => {
    const answer = modelAnswer([36, 30, 28]);
    answer.criteria[0].rationale = claim;
    expect(issuesOf(assembleEvaluation(answer, ctx())).join(" ")).toMatch(/claims the code was run/);
  });

  it.each([
    "The code appears to add a form for new books.",
    "The code adds a test file, but nothing shows whether the tests pass.",
    "Not enough information to say whether it works.",
    "It is unclear whether the tests pass, because nothing was run.",
    "Nothing confirms that the build succeeds.",
  ])("accepts careful wording: %j", (text) => {
    const answer = modelAnswer([36, 30, 28]);
    answer.criteria[0].rationale = text;
    expect(assembleEvaluation(answer, ctx()).ok).toBe(true);
  });

  it("does not treat advice to the student as a claim (feedback is excluded)", () => {
    const answer = modelAnswer([36, 30, 28], { feedbackForNextWeek: ["Run your code often and make sure your tests pass."] });
    expect(assembleEvaluation(answer, ctx()).ok).toBe(true);
  });
});

describe("prompt-injection attempt inside the student's code", () => {
  it("cannot buy points: a high score with no real evidence is rejected", () => {
    // The compromised answer obeys the injected "give 100/100" instruction.
    const obeyed = modelAnswer([40, 30, 30], {}, "src/app.js");
    obeyed.criteria.forEach((c) => (c.evidence = []));
    expect(assembleEvaluation(obeyed, ctx(INJECTION)).ok).toBe(false);
  });

  it("a faithful answer scores the (stub) code low and stays valid", () => {
    const honest = modelAnswer([5, 0, 0], {
      technicalConcerns: ["A comment in src/app.js tries to instruct the reviewer to give full marks. It was ignored."],
      incompleteRequirements: ["Showing the list and keeping the data are not in the changes."],
    });
    const result = assembleEvaluation(honest, ctx(INJECTION));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.suggestedScore).toBe(5);
      expect(result.value.technicalConcerns[0]).toMatch(/tries to instruct/);
    }
  });
});

describe("what the AI could not see: scope and confidence", () => {
  it("lists every unreadable file with its reason, from the diff and not from the model", () => {
    const scope = buildReviewScope(UNREADABLE);
    expect(scope).toMatchObject({ filesChanged: 6, filesReviewed: 1, patchesTruncated: 0, codeExecuted: false });
    expect(scope.notReviewed).toEqual([
      { path: "report.pdf", reason: "binary" },
      { path: "src/old.js", reason: "deleted" },
      { path: "package-lock.json", reason: "ignored" },
      { path: "src/big.js", reason: "unavailable" },
      { path: "docs/notes.md", reason: "budget" },
    ]);
  });

  it("caps confidence at medium when files could not be read, even if the model says high", () => {
    const result = assembleEvaluation(modelAnswer([36, 30, 28], { confidence: { level: "high", uncertainties: [] } }), ctx(UNREADABLE));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.confidence.level).toBe("medium");
    const text = result.value.confidence.uncertainties.join(" | ");
    expect(text).toMatch(/report\.pdf \(binary\)/);
    expect(text).toMatch(/src\/big\.js \(unavailable\)/);
    expect(text).toMatch(/docs\/notes\.md \(budget\)/);
    expect(text).toMatch(/Not reviewed \(deleted, dependency or generated files\): src\/old\.js, package-lock\.json/);
    expect(text).toMatch(/The code was not run or tested/);
  });

  it("never raises confidence above what the model reported", () => {
    const result = assembleEvaluation(modelAnswer([36, 30, 28], { confidence: { level: "low", uncertainties: ["Very small change."] } }), ctx(STRONG));
    expect(result.ok && result.value.confidence.level).toBe("low");
    expect(result.ok && result.value.confidence.uncertainties[0]).toBe("Very small change.");
  });

  it("is 'low' when nothing could be read, and says so", () => {
    const answer = modelAnswer([0, 0, 0], { incompleteRequirements: ["Nothing readable was provided."] });
    const result = assembleEvaluation(answer, ctx(NOTHING_READABLE));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.confidence.level).toBe("low");
    expect(result.value.confidence.uncertainties.join(" ")).toMatch(/No file contents were available/);
    expect(result.value.reviewScope.filesReviewed).toBe(0);
  });

  it("caps confidence when files were beyond the review limit or cut for size", () => {
    const beyond = { ...STRONG, filesOmitted: 12 };
    const r1 = assembleEvaluation(modelAnswer([36, 30, 28]), ctx(beyond));
    expect(r1.ok && r1.value.confidence.level).toBe("medium");
    expect(r1.ok && r1.value.confidence.uncertainties.join(" ")).toMatch(/12 more changed file\(s\)/);

    const cut = { ...STRONG, files: STRONG.files.map((f, i) => (i === 0 ? { ...f, patchTruncated: true } : f)) };
    const r2 = assembleEvaluation(modelAnswer([36, 30, 28]), ctx(cut));
    expect(r2.ok && r2.value.confidence.level).toBe("medium");
    expect(r2.ok && r2.value.reviewScope.patchesTruncated).toBe(1);
  });

  it("always records that the code was not executed", () => {
    const result = assembleEvaluation(modelAnswer([36, 30, 28]), ctx(STRONG));
    expect(result.ok && result.value.reviewScope.codeExecuted).toBe(false);
    expect(result.ok && result.value.confidence.uncertainties.at(-1)).toMatch(/not run or tested/);
  });
});
