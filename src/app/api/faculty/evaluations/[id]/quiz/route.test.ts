import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  detail: null as null | { evaluation: { checkpointId: string } },
  quizzes: undefined as unknown as {
    store: { getByCheckpoint: (id: string) => Promise<unknown>; insertQuiz: (q: unknown) => Promise<{ id: string; questions: { correctIndex: number }[] }>; insertAttempt: (a: unknown) => Promise<unknown> };
    quizzes: unknown[];
    attempts: unknown[];
  },
}));

vi.mock("@/lib/review/repository", () => ({ reviewStore: { getDetail: vi.fn(async () => state.detail) } }));
vi.mock("@/lib/quiz/repository", async () => {
  const { memoryQuizStore } = await import("@/test/memory-quiz-store");
  state.quizzes = memoryQuizStore() as never;
  return { quizStore: state.quizzes.store };
});
vi.mock("@/lib/db/supabase", () => ({ StorageConfigError: class extends Error {} }));

import { modelQuiz } from "@/lib/quiz/fixtures";
import { assembleQuiz } from "@/lib/quiz/assemble";
import { GET } from "./route";

const evaluationId = "123e4567-e89b-42d3-a456-426614174000";
const checkpointId = "223e4567-e89b-42d3-a456-426614174000";
const projectId = "323e4567-e89b-42d3-a456-426614174000";
const ctx = (id: string) => ({ params: Promise.resolve({ id }) }) as never;
const get = () => new Request("http://localhost/x");

async function seedQuiz() {
  const assembled = assembleQuiz(modelQuiz());
  if (!assembled.ok) throw new Error("fixture invalid");
  return state.quizzes.store.insertQuiz({ projectId, checkpointId, weekNumber: 1, questions: assembled.value, model: "m" });
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  state.detail = { evaluation: { checkpointId } };
  state.quizzes.quizzes.length = 0;
  state.quizzes.attempts.length = 0;
});

describe("GET /api/faculty/evaluations/[id]/quiz", () => {
  it("400 for an id that is not a UUID", async () => {
    expect((await GET(get(), ctx("nope"))).status).toBe(400);
  });

  it("404 when the evaluation does not exist", async () => {
    state.detail = null;
    const res = await GET(get(), ctx(evaluationId));
    expect(res.status).toBe(404);
  });

  it("returns { quiz: null } when no quiz was created for that week", async () => {
    const res = await GET(get(), ctx(evaluationId));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ quiz: null });
  });

  it("withholds the answers while the student has not attempted the quiz", async () => {
    await seedQuiz();
    const text = await (await GET(get(), ctx(evaluationId))).text();
    expect(JSON.parse(text).quiz.state).toBe("open");
    expect(text).not.toMatch(/correctIndex|explanation/);
  });

  it("shows the score and the review once the student has attempted it", async () => {
    const quiz = await seedQuiz();
    await state.quizzes.store.insertAttempt({
      quizId: quiz.id,
      answers: quiz.questions.map((q, i) => (i < 4 ? q.correctIndex : (q.correctIndex + 1) % 4)),
      correctCount: 4,
      total: 5,
    });
    const body = await (await GET(get(), ctx(evaluationId))).json();
    expect(body.quiz).toMatchObject({ state: "taken", correctCount: 4, total: 5 });
    expect(body.quiz.questions[4]).toHaveProperty("explanation");
  });

  it("finds the quiz through the evaluation's own checkpoint, not another week's", async () => {
    await seedQuiz();
    state.detail = { evaluation: { checkpointId: "423e4567-e89b-42d3-a456-426614174000" } };
    expect(await (await GET(get(), ctx(evaluationId))).json()).toEqual({ quiz: null });
  });
});
