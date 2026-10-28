import { describe, expect, it } from "vitest";
import { FAILURE_MESSAGES, mergeTrace, projectProgress, WorkflowProgressSchema, type TraceEntry } from "./progress";

const t = (node: TraceEntry["node"], run = 1, attempt = 1, result: TraceEntry["result"] = "ok"): TraceEntry => ({ run, node, attempt, result });
const statuses = (progress: ReturnType<typeof projectProgress>) => Object.fromEntries(progress.steps.map((s) => [s.id, s.status]));

describe("mergeTrace", () => {
  it("drops an entry that is already there, so a repeated node cannot add it twice", () => {
    const first = mergeTrace([], [t("extract_text")]);
    expect(mergeTrace(first, [t("extract_text"), t("check_readable")])).toEqual([t("extract_text"), t("check_readable")]);
  });

  it("keeps the same step of different attempts and different runs", () => {
    expect(mergeTrace([t("grade", 1, 1)], [t("grade", 1, 2), t("grade", 2, 1)])).toHaveLength(3);
  });

  it("keeps only the current and the previous run", () => {
    const merged = mergeTrace([t("grade", 1), t("grade", 2)], [t("grade", 3)]);
    expect(merged.map((e) => e.run)).toEqual([2, 3]);
  });
});

describe("projectProgress", () => {
  it("is not started without a snapshot or a run", () => {
    expect(projectProgress(null).state).toBe("not_started");
    expect(projectProgress({ values: {}, next: [], interrupted: false }).state).toBe("not_started");
  });

  it("marks finished steps done, the next one active, and the rest pending", () => {
    const progress = projectProgress({ values: { run: 1, trace: [t("extract_text"), t("check_readable")] }, next: ["grade"], interrupted: false });
    expect(progress.state).toBe("running");
    expect(statuses(progress)).toMatchObject({ extract_text: "done", check_readable: "done", grade: "active", check_grade: "pending" });
  });

  it("shows the faculty step as waiting while the graph is paused there", () => {
    const trace = [t("extract_text"), t("check_readable"), t("grade"), t("check_grade"), t("save_result")];
    const progress = projectProgress({ values: { run: 1, trace }, next: ["await_faculty"], interrupted: true });
    expect(progress.state).toBe("waiting_faculty");
    expect(statuses(progress).await_faculty).toBe("waiting");
  });

  it("shows the attempt number only once a step was done more than once", () => {
    const progress = projectProgress({
      values: { run: 1, trace: [t("extract_text"), t("check_readable"), t("grade", 1, 1), t("check_grade", 1, 1, "retry"), t("grade", 1, 2)] },
      next: ["check_grade"],
      interrupted: false,
    });
    expect(progress.steps.find((s) => s.id === "grade")).toMatchObject({ status: "done", attempt: 2 });
    expect(progress.steps.find((s) => s.id === "extract_text")?.attempt).toBeUndefined();
  });

  it("ignores entries of an earlier run", () => {
    const progress = projectProgress({ values: { run: 2, trace: [t("extract_text", 1), t("check_readable", 1)] }, next: ["extract_text"], interrupted: false });
    expect(statuses(progress)).toMatchObject({ extract_text: "active", check_readable: "pending" });
  });

  it("a failure shows the step that failed, skips the rest, and uses the fixed sentence", () => {
    const progress = projectProgress({
      values: { run: 1, outcome: "failed", failureCode: "marking_unavailable", trace: [t("extract_text"), t("check_readable"), t("grade", 1, 1, "failed")] },
      next: [],
      interrupted: false,
    });
    expect(progress.state).toBe("failed");
    expect(statuses(progress)).toMatchObject({ grade: "failed", check_grade: "skipped", await_faculty: "skipped" });
    expect(progress.failure).toEqual({ code: "marking_unavailable", message: FAILURE_MESSAGES.marking_unavailable });
  });

  it("reads only the allowlisted fields, whatever else the snapshot holds", () => {
    const hostile = {
      run: 1,
      outcome: "running",
      trace: [t("extract_text")],
      aiResult: { feedback: "SECRET FEEDBACK" },
      rawGrading: "SECRET RAW",
      failureReason: "SECRET REASON",
      gradeIssues: "SECRET ISSUES",
    };
    const progress = projectProgress({ values: hostile as never, next: ["check_readable"], interrupted: false });
    expect(JSON.stringify(progress)).not.toContain("SECRET");
    expect(WorkflowProgressSchema.safeParse(progress).success).toBe(true);
  });
});
