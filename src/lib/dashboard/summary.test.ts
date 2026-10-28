import { describe, expect, it } from "vitest";
import type { StudentResult } from "@/lib/schemas/review";
import { average, repoName, summarizeProject, summarizeStudent } from "./summary";

const sha = "a".repeat(40);
const checkpoint = (weekNumber: number) => ({ weekNumber, commitSha: sha, baseCommitSha: sha }) as never;
const result = (weekNumber: number, officialScore: number | null, outcome: StudentResult["outcome"] = "approved"): StudentResult => ({
  weekNumber,
  outcome,
  officialScore,
  feedback: null,
  decidedAt: "2026-10-26T10:00:00+00:00",
});

describe("average", () => {
  it("is null for nothing, never 0", () => expect(average([])).toBeNull());
  it("rounds to one decimal", () => expect(average([100, 85, 85])).toBe(90));
  it("keeps a real zero", () => expect(average([0])).toBe(0));
});

describe("repoName", () => {
  it.each([
    ["https://github.com/Tison12345/AI_Agent_Teacher", "Tison12345/AI_Agent_Teacher"],
    ["https://github.com/o/r.git", "o/r"],
    ["https://github.com/o/r/tree/main", "o/r"],
    ["not a url", "not a url"],
  ])("%s -> %s", (input, expected) => expect(repoName(input)).toBe(expected));
});

describe("summarizeProject", () => {
  it("a project with nothing recorded: every week unrecorded, no average", () => {
    const s = summarizeProject({ durationWeeks: 3 }, { checkpoints: [], evaluations: [] }, []);
    expect(s).toMatchObject({ recorded: 0, approved: 0, pendingReview: 0, unrecorded: 3, average: null });
    expect(s.weeks.map((w) => [w.score, w.note])).toEqual([
      [null, "Not recorded"],
      [null, "Not recorded"],
      [null, "Not recorded"],
    ]);
  });

  it("approved, pending and unrecorded weeks are counted separately and add up", () => {
    const s = summarizeProject(
      { durationWeeks: 4 },
      {
        checkpoints: [checkpoint(1), checkpoint(2), checkpoint(3)],
        evaluations: [
          { weekNumber: 1, status: "approved" },
          { weekNumber: 2, status: "edited" },
          { weekNumber: 3, status: "pending_review" },
        ],
      },
      [result(1, 80), result(2, 60, "edited")],
    );
    expect(s).toMatchObject({ recorded: 3, approved: 2, pendingReview: 1, unrecorded: 1, average: 70 });
    expect(s.weeks.map((w) => w.score ?? w.note)).toEqual([80, 60, "Awaiting review", "Not recorded"]);
  });

  it("a genuine zero is a score; an unrecorded week is not", () => {
    const s = summarizeProject(
      { durationWeeks: 2 },
      { checkpoints: [checkpoint(1)], evaluations: [{ weekNumber: 1, status: "approved" }] },
      [result(1, 0)],
    );
    expect(s.average).toBe(0);
    expect(s.weeks[0]).toMatchObject({ score: 0 });
    expect(s.weeks[1]).toMatchObject({ score: null, note: "Not recorded" });
  });

  it("a rejected week has no mark and does not count as approved or pending", () => {
    const s = summarizeProject(
      { durationWeeks: 1 },
      { checkpoints: [checkpoint(1)], evaluations: [{ weekNumber: 1, status: "rejected" }] },
      [result(1, null, "rejected")],
    );
    expect(s).toMatchObject({ approved: 0, pendingReview: 0, rejected: 1, average: null });
    expect(s.weeks[0]).toMatchObject({ score: null, note: "No mark" });
  });

  it("a recorded week with no evaluation yet says so", () => {
    const s = summarizeProject({ durationWeeks: 1 }, { checkpoints: [checkpoint(1)], evaluations: [] }, []);
    expect(s.weeks[0].note).toBe("Not evaluated");
  });
});

describe("summarizeStudent", () => {
  it("with no projects there is nothing to average", () => {
    expect(summarizeStudent([])).toMatchObject({ projects: 0, average: null, recorded: 0, totalWeeks: 0 });
  });

  it("pools the official scores of every project", () => {
    const a = summarizeProject(
      { durationWeeks: 2 },
      { checkpoints: [checkpoint(1)], evaluations: [{ weekNumber: 1, status: "approved" }] },
      [result(1, 100)],
    );
    const b = summarizeProject(
      { durationWeeks: 3 },
      {
        checkpoints: [checkpoint(1), checkpoint(2)],
        evaluations: [
          { weekNumber: 1, status: "approved" },
          { weekNumber: 2, status: "pending_review" },
        ],
      },
      [result(1, 50)],
    );
    expect(summarizeStudent([a, b])).toEqual({
      projects: 2,
      average: 75,
      scoredWeeks: 2,
      recorded: 3,
      totalWeeks: 5,
      pendingReview: 1,
      approved: 2,
    });
  });
});
