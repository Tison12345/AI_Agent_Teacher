import { describe, expect, it } from "vitest";
import { CheckpointSchema } from "./checkpoint";
import { EvaluationSchema } from "./evaluation";
import { ProjectSchema } from "./project";
import { TeacherDecisionSchema } from "./teacher-decision";
import { GeneratedPlanSchema, WeeklyPlanSchema, type WeeklyPlanItem } from "./weekly-plan";

const uuid = "123e4567-e89b-42d3-a456-426614174000";
const uuid2 = "223e4567-e89b-42d3-a456-426614174000";
const sha = "a".repeat(40);
const now = "2026-10-25T12:00:00+00:00";

const week = (n: number): WeeklyPlanItem => ({
  weekNumber: n,
  title: `Week ${n}`,
  objectives: ["Learn"],
  tasks: ["Build"],
  deliverables: ["Code"],
  evaluationCriteria: [
    { name: "Works", description: "It runs", maxPoints: 60 },
    { name: "Quality", description: "Clean code", maxPoints: 40 },
  ],
});

describe("ProjectSchema", () => {
  const project = {
    id: uuid,
    title: "Smart Attendance",
    description: "A system that marks attendance using faces.",
    repoUrl: "https://github.com/octocat/hello-world",
    durationWeeks: 12,
    createdAt: now,
  };
  it("accepts a valid project", () => {
    expect(ProjectSchema.safeParse(project).success).toBe(true);
  });
  it("rejects a duration other than 12 and a bad id", () => {
    expect(ProjectSchema.safeParse({ ...project, durationWeeks: 8 }).success).toBe(false);
    expect(ProjectSchema.safeParse({ ...project, id: "nope" }).success).toBe(false);
  });
});

describe("WeeklyPlanSchema", () => {
  const plan = Array.from({ length: 12 }, (_, i) => week(i + 1));
  it("accepts exactly 12 ordered weeks", () => {
    expect(WeeklyPlanSchema.safeParse(plan).success).toBe(true);
  });
  it("rejects 11 weeks, wrong order and empty tasks", () => {
    expect(WeeklyPlanSchema.safeParse(plan.slice(0, 11)).success).toBe(false);
    expect(WeeklyPlanSchema.safeParse([...plan].reverse()).success).toBe(false);
    const empty = plan.map((w, i) => (i === 0 ? { ...w, tasks: [] } : w));
    expect(WeeklyPlanSchema.safeParse(empty).success).toBe(false);
    const off = plan.map((w, i) =>
      i === 2 ? { ...w, evaluationCriteria: [{ name: "A", description: "a", maxPoints: 50 }, { name: "B", description: "b", maxPoints: 40 }] } : w,
    );
    expect(WeeklyPlanSchema.safeParse(off).success).toBe(false);
  });
});

describe("stored vs. generated plan shapes", () => {
  const roomy = (n: number): WeeklyPlanItem => ({
    ...week(n),
    objectives: ["a", "b", "c"],
    tasks: ["1", "2", "3", "4", "5", "6"],
    deliverables: ["x", "y"],
    evaluationCriteria: [25, 25, 25, 25].map((p, i) => ({ name: "C" + i, description: "d", maxPoints: p })),
  });
  const oldPlan = Array.from({ length: 12 }, (_, i) => roomy(i + 1));

  it("still loads plans saved earlier (more tasks, goals and criteria)", () => {
    expect(WeeklyPlanSchema.safeParse(oldPlan).success).toBe(true);
  });
  it("requires the simplified shape for newly generated plans", () => {
    expect(GeneratedPlanSchema.safeParse(oldPlan).success).toBe(false);
  });
});

describe("CheckpointSchema", () => {
  const checkpoint = {
    id: uuid,
    projectId: uuid2,
    weekNumber: 1,
    commitSha: sha,
    baseCommitSha: "b".repeat(40),
    branch: "main",
    filesChanged: 3,
    additions: 10,
    deletions: 2,
    recordedAt: now,
  };
  it("accepts a valid checkpoint", () => {
    expect(CheckpointSchema.safeParse(checkpoint).success).toBe(true);
  });
  it("requires a base commit (no null base any more)", () => {
    expect(CheckpointSchema.safeParse({ ...checkpoint, baseCommitSha: null }).success).toBe(false);
  });
  it("rejects short/uppercase SHAs, week 13 and negative counts", () => {
    expect(CheckpointSchema.safeParse({ ...checkpoint, commitSha: "abc123" }).success).toBe(false);
    expect(CheckpointSchema.safeParse({ ...checkpoint, commitSha: "A".repeat(40) }).success).toBe(false);
    expect(CheckpointSchema.safeParse({ ...checkpoint, weekNumber: 13 }).success).toBe(false);
    expect(CheckpointSchema.safeParse({ ...checkpoint, additions: -1 }).success).toBe(false);
  });
});

describe("EvaluationSchema", () => {
  const evaluation = {
    id: uuid,
    projectId: uuid2,
    checkpointId: uuid2,
    weekNumber: 1,
    suggestedScore: 72,
    criteriaAssessments: [
      {
        criterion: "Works",
        score: 7,
        maxScore: 10,
        rationale: "Mostly works",
        evidence: [{ filePath: "src/a.ts", summary: "Adds parser" }],
      },
    ],
    completedRequirements: ["Parser"],
    incompleteRequirements: ["Tests"],
    technicalConcerns: [],
    feedbackForNextWeek: ["Add tests"],
    confidence: { level: "medium", uncertainties: ["Small diff"] },
    status: "pending_review",
    createdAt: now,
  };
  it("accepts a valid evaluation", () => {
    expect(EvaluationSchema.safeParse(evaluation).success).toBe(true);
  });
  it("rejects out-of-range scores and score above maxScore", () => {
    expect(EvaluationSchema.safeParse({ ...evaluation, suggestedScore: 101 }).success).toBe(false);
    const over = {
      ...evaluation,
      criteriaAssessments: [{ ...evaluation.criteriaAssessments[0], score: 11 }],
    };
    expect(EvaluationSchema.safeParse(over).success).toBe(false);
  });
  it("rejects an unknown status", () => {
    expect(EvaluationSchema.safeParse({ ...evaluation, status: "done" }).success).toBe(false);
  });
});

describe("TeacherDecisionSchema", () => {
  const base = {
    id: uuid,
    evaluationId: uuid2,
    approvedFeedback: "Good",
    comment: null,
    decidedAt: now,
  };
  it("requires a score for approve/edit", () => {
    expect(TeacherDecisionSchema.safeParse({ ...base, decision: "approve", approvedScore: 80 }).success).toBe(true);
    expect(TeacherDecisionSchema.safeParse({ ...base, decision: "edit", approvedScore: null }).success).toBe(false);
  });
  it("requires null score for reject", () => {
    expect(TeacherDecisionSchema.safeParse({ ...base, decision: "reject", approvedScore: null }).success).toBe(true);
    expect(TeacherDecisionSchema.safeParse({ ...base, decision: "reject", approvedScore: 50 }).success).toBe(false);
  });
});
