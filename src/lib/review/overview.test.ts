import { beforeEach, describe, expect, it } from "vitest";
import { assembleEvaluation } from "@/lib/evaluation/assemble";
import { STRONG, WEEK, modelAnswer } from "@/lib/evaluation/fixtures";
import { assembleQuiz } from "@/lib/quiz/assemble";
import { modelQuiz } from "@/lib/quiz/fixtures";
import { ProjectOverviewSchema } from "@/lib/schemas/overview";
import type { Project } from "@/lib/schemas/project";
import type { StoredPlan } from "@/lib/schemas/weekly-plan";
import { memoryStore } from "@/test/memory-checkpoint-store";
import { memoryEvaluationStore } from "@/test/memory-evaluation-store";
import { memoryQuizStore } from "@/test/memory-quiz-store";
import { memoryReviewStore } from "@/test/memory-review-store";
import { buildProjectOverview, type OverviewDeps } from "./overview";

const PROJECT = "123e4567-e89b-42d3-a456-426614174000";
const OTHER = "223e4567-e89b-42d3-a456-426614174000";
const sha = (c: string) => c.repeat(40);

const project: Project = {
  id: PROJECT,
  title: "Library app",
  description: "A small app to keep track of books I read.",
  repoUrl: "https://github.com/octocat/hello-world",
  durationWeeks: 4,
  createdAt: "2026-10-26T09:00:00+00:00",
};

const plan: StoredPlan = {
  projectId: PROJECT,
  model: "m",
  generatedAt: "2026-10-26T09:05:00+00:00",
  plan: Array.from({ length: 4 }, (_, i) => ({ ...WEEK, weekNumber: i + 1, title: `Plan for week ${i + 1}` })),
};

let checkpoints: ReturnType<typeof memoryStore>;
let evaluations: ReturnType<typeof memoryEvaluationStore>;
let quizzes: ReturnType<typeof memoryQuizStore>;
let review: ReturnType<typeof memoryReviewStore>;
let deps: OverviewDeps;

const record = (week: number, projectId = PROJECT) =>
  checkpoints.store.insertCheckpoint({
    projectId,
    weekNumber: week,
    commitSha: sha(String(week)),
    baseCommitSha: sha("0"),
    branch: "main",
    filesChanged: 2,
    additions: 20,
    deletions: 0,
  });

async function evaluate(checkpointId: string, week: number, projectId = PROJECT, parts: [number, number, number] = [36, 30, 28]) {
  const assembled = assembleEvaluation(modelAnswer(parts), { criteria: WEEK.evaluationCriteria, snapshot: STRONG });
  if (!assembled.ok) throw new Error("fixture should be valid");
  return evaluations.store.insert({ projectId, checkpointId, weekNumber: week, result: assembled.value, snapshot: STRONG, model: "m" });
}

async function takeQuiz(checkpointId: string, week: number, correct: number) {
  const assembled = assembleQuiz(modelQuiz());
  if (!assembled.ok) throw new Error("fixture should be valid");
  const quiz = await quizzes.store.insertQuiz({ projectId: PROJECT, checkpointId, weekNumber: week, questions: assembled.value, model: "m" });
  await quizzes.store.insertAttempt({ quizId: quiz.id, answers: [0, 0, 0, 0, 0], correctCount: correct, total: 5 });
}

beforeEach(() => {
  checkpoints = memoryStore();
  evaluations = memoryEvaluationStore();
  quizzes = memoryQuizStore();
  review = memoryReviewStore(evaluations.rows, [{ id: PROJECT, title: project.title, repoUrl: project.repoUrl }], quizzes);
  deps = {
    getProject: async (id) => (id === PROJECT ? project : null),
    getPlan: async () => plan,
    checkpoints: checkpoints.store,
    review: review.store,
    quizzes: quizzes.store,
  };
});

describe("buildProjectOverview", () => {
  it("is null for a project that does not exist", async () => {
    expect(await buildProjectOverview(OTHER, deps)).toBeNull();
  });

  it("lists every week of the project, including weeks nobody has recorded", async () => {
    const overview = (await buildProjectOverview(PROJECT, deps))!;
    expect(overview.project).toEqual({
      id: PROJECT,
      title: "Library app",
      description: project.description,
      repoUrl: project.repoUrl,
      durationWeeks: 4,
    });
    expect(overview.weeks.map((w) => [w.weekNumber, w.state])).toEqual([
      [1, "not_recorded"],
      [2, "not_recorded"],
      [3, "not_recorded"],
      [4, "not_recorded"],
    ]);
    expect(overview.weeks[0]).toMatchObject({ title: "Plan for week 1", recordedAt: null, evaluationId: null, officialScore: null, ai: null });
    expect(ProjectOverviewSchema.safeParse(overview).success).toBe(true);
  });

  it("tells apart a recorded week, one waiting for review, and a decided one", async () => {
    const cp1 = await record(1);
    const cp2 = await record(2);
    await record(3);
    const e1 = await evaluate(cp1.id, 1);
    await evaluate(cp2.id, 2, PROJECT, [10, 10, 10]);
    await review.store.decide({ evaluationId: e1.evaluation.id, decision: "approve", approvedScore: 94, approvedFeedback: "- Do X", comment: "Private note" });
    await takeQuiz(cp1.id, 1, 1);

    const { weeks } = (await buildProjectOverview(PROJECT, deps))!;
    expect(weeks.map((w) => w.state)).toEqual(["approved", "pending_review", "not_evaluated", "not_recorded"]);

    // Week 1: decided, with everything a teacher needs.
    expect(weeks[0]).toMatchObject({
      weekNumber: 1,
      title: "Plan for week 1",
      evaluationId: e1.evaluation.id,
      suggestedScore: 94,
      officialScore: 94,
      teacherFeedback: "- Do X",
      teacherComment: "Private note",
      quiz: { status: "taken", correctCount: 1, total: 5 },
    });
    expect(weeks[0].recordedAt).toBe(cp1.recordedAt);
    expect(weeks[0].ai).toMatchObject({ confidence: "high" });
    expect(weeks[0].ai?.completed.length).toBeGreaterThan(0);
    expect(weeks[0].ai?.feedback.length).toBeGreaterThan(0);

    // Week 2: only the AI has spoken; nothing official, no quiz.
    expect(weeks[1]).toMatchObject({
      state: "pending_review",
      suggestedScore: 30,
      officialScore: null,
      teacherFeedback: null,
      teacherComment: null,
      quiz: { status: "not_created", correctCount: null, total: null },
    });

    // Week 3: recorded, but no evaluation yet.
    expect(weeks[2]).toMatchObject({ state: "not_evaluated", evaluationId: null, suggestedScore: null, ai: null });
    expect(weeks[2].recordedAt).not.toBeNull();
  });

  it("shows the teacher's own score for an edit, and no score for a rejection", async () => {
    const cp1 = await record(1);
    const cp2 = await record(2);
    const e1 = await evaluate(cp1.id, 1);
    const e2 = await evaluate(cp2.id, 2);
    await review.store.decide({ evaluationId: e1.evaluation.id, decision: "edit", approvedScore: 65, approvedFeedback: "Own words", comment: "Why" });
    await review.store.decide({ evaluationId: e2.evaluation.id, decision: "reject", approvedScore: null, approvedFeedback: null, comment: "AI missed files" });

    const { weeks } = (await buildProjectOverview(PROJECT, deps))!;
    expect(weeks[0]).toMatchObject({ state: "edited", suggestedScore: 94, officialScore: 65, teacherFeedback: "Own words" });
    expect(weeks[1]).toMatchObject({ state: "rejected", officialScore: null, teacherFeedback: null, teacherComment: "AI missed files" });
  });

  it("reports a quiz that exists but has not been taken", async () => {
    const cp1 = await record(1);
    await evaluate(cp1.id, 1);
    const assembled = assembleQuiz(modelQuiz());
    if (!assembled.ok) throw new Error("fixture should be valid");
    await quizzes.store.insertQuiz({ projectId: PROJECT, checkpointId: cp1.id, weekNumber: 1, questions: assembled.value, model: "m" });
    expect((await buildProjectOverview(PROJECT, deps))!.weeks[0].quiz.status).toBe("not_taken");
  });

  it("finds a quiz even for a week that has not been evaluated", async () => {
    const cp1 = await record(1);
    await takeQuiz(cp1.id, 1, 4);
    expect((await buildProjectOverview(PROJECT, deps))!.weeks[0]).toMatchObject({ state: "not_evaluated", quiz: { status: "taken", correctCount: 4 } });
  });

  it("never mixes in another project's weeks", async () => {
    const mine = await record(1);
    const theirs = await record(1, OTHER);
    await evaluate(mine.id, 1);
    await evaluate(theirs.id, 1, OTHER, [0, 0, 0]);
    const { weeks } = (await buildProjectOverview(PROJECT, deps))!;
    expect(weeks[0].suggestedScore).toBe(94);
    expect(weeks.filter((w) => w.evaluationId)).toHaveLength(1);
  });

  it("works when the project has no plan: titles are null", async () => {
    deps.getPlan = async () => null;
    const { weeks } = (await buildProjectOverview(PROJECT, deps))!;
    expect(weeks.every((w) => w.title === null)).toBe(true);
    expect(weeks).toHaveLength(4);
  });

  it("follows the project's own length", async () => {
    deps.getProject = async () => ({ ...project, durationWeeks: 1 });
    expect((await buildProjectOverview(PROJECT, deps))!.weeks).toHaveLength(1);
  });
});
