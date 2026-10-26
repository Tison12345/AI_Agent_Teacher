import { beforeEach, describe, expect, it, vi } from "vitest";

const PROJECT = "123e4567-e89b-42d3-a456-426614174000";

const state = vi.hoisted(() => ({
  project: null as unknown,
  plan: null as unknown,
  failWith: null as Error | null,
  checkpoints: undefined as unknown as { store: unknown; checkpoints: unknown[] },
  evaluations: undefined as unknown as { store: unknown; rows: unknown[] },
  quizzes: undefined as unknown,
  review: undefined as unknown as { store: unknown },
}));

vi.mock("@/lib/db/supabase", () => ({ StorageConfigError: class extends Error {} }));
vi.mock("@/lib/projects/repository", () => ({
  RepositoryError: class extends Error {},
  getProject: async () => {
    if (state.failWith) throw state.failWith;
    return state.project;
  },
}));
vi.mock("@/lib/plans/repository", () => ({ getPlan: async () => state.plan }));
vi.mock("@/lib/checkpoints/repository", async () => {
  const { memoryStore } = await import("@/test/memory-checkpoint-store");
  state.checkpoints = memoryStore();
  return { checkpointStore: state.checkpoints.store };
});
vi.mock("@/lib/quiz/repository", async () => {
  const { memoryQuizStore } = await import("@/test/memory-quiz-store");
  const quizzes = memoryQuizStore();
  state.quizzes = quizzes;
  return { quizStore: quizzes.store };
});
vi.mock("@/lib/review/repository", async () => {
  const { memoryEvaluationStore } = await import("@/test/memory-evaluation-store");
  const { memoryReviewStore } = await import("@/test/memory-review-store");
  state.evaluations = memoryEvaluationStore();
  state.review = memoryReviewStore(state.evaluations.rows as never, [], state.quizzes as never);
  return { reviewStore: state.review.store };
});

import { assembleEvaluation } from "@/lib/evaluation/assemble";
import { STRONG, WEEK, modelAnswer } from "@/lib/evaluation/fixtures";
import { GET } from "./route";

const ctx = (id: string) => ({ params: Promise.resolve({ id }) }) as never;
const get = () => new Request("http://localhost/x");

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  state.failWith = null;
  state.project = {
    id: PROJECT,
    title: "Library app",
    description: "A small app to keep track of books I read.",
    repoUrl: "https://github.com/octocat/hello-world",
    durationWeeks: 2,
    createdAt: "2026-10-26T09:00:00+00:00",
  };
  state.plan = null;
  (state.checkpoints.checkpoints as unknown[]).length = 0;
  state.evaluations.rows.length = 0;
});

describe("GET /api/faculty/projects/[id]", () => {
  it("400 for an id that is not a UUID", async () => {
    expect((await GET(get(), ctx("nope"))).status).toBe(400);
  });

  it("404 for a project that does not exist", async () => {
    state.project = null;
    const res = await GET(get(), ctx(PROJECT));
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("not_found");
  });

  it("returns the project with every week, including weeks nobody has recorded", async () => {
    const res = await GET(get(), ctx(PROJECT));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.project).toMatchObject({ id: PROJECT, title: "Library app", durationWeeks: 2 });
    expect(body.weeks.map((w: { state: string }) => w.state)).toEqual(["not_recorded", "not_recorded"]);
  });

  it("returns a recorded and evaluated week with the AI recommendation", async () => {
    const checkpoint = await (state.checkpoints.store as { insertCheckpoint: (c: unknown) => Promise<{ id: string }> }).insertCheckpoint({
      projectId: PROJECT,
      weekNumber: 1,
      commitSha: "1".repeat(40),
      baseCommitSha: "0".repeat(40),
      branch: "main",
      filesChanged: 2,
      additions: 20,
      deletions: 0,
    });
    const assembled = assembleEvaluation(modelAnswer([36, 30, 28]), { criteria: WEEK.evaluationCriteria, snapshot: STRONG });
    if (!assembled.ok) throw new Error("fixture should be valid");
    await (state.evaluations.store as { insert: (e: unknown) => Promise<unknown> }).insert({
      projectId: PROJECT,
      checkpointId: checkpoint.id,
      weekNumber: 1,
      result: assembled.value,
      snapshot: STRONG,
      model: "m",
    });
    const body = await (await GET(get(), ctx(PROJECT))).json();
    expect(body.weeks[0]).toMatchObject({ state: "pending_review", suggestedScore: 94, officialScore: null, quiz: { status: "not_created" } });
    expect(body.weeks[1].state).toBe("not_recorded");
  });

  it("503 when storage is not configured, without details", async () => {
    const { StorageConfigError } = await import("@/lib/db/supabase");
    state.failWith = new StorageConfigError();
    const res = await GET(get(), ctx(PROJECT));
    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe("storage_unavailable");
  });

  it("500 with a safe message on an unexpected failure", async () => {
    state.failWith = new Error("connection string postgres://secret");
    const res = await GET(get(), ctx(PROJECT));
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toMatch(/secret|postgres/);
  });
});
