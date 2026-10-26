import { beforeEach, describe, expect, it, vi } from "vitest";
import { GeminiError } from "@/lib/gemini/errors";

const state = vi.hoisted(() => ({
  duration: 12,
  checkpoints: undefined as unknown as { store: unknown; checkpoints: unknown[] },
  quizzes: undefined as unknown as { store: unknown; quizzes: { questions: { correctIndex: number }[] }[]; attempts: unknown[] },
  plan: null as unknown,
  gemini: { generateContent: undefined as unknown as ReturnType<typeof vi.fn> },
  geminiConfigured: true,
  compare: undefined as unknown,
}));

vi.mock("@/lib/projects/repository", () => ({
  getProject: vi.fn(async () => ({ id: "x", repoUrl: "https://github.com/octocat/hello-world", durationWeeks: state.duration })),
}));
vi.mock("@/lib/checkpoints/repository", async () => {
  const { memoryStore } = await import("@/test/memory-checkpoint-store");
  state.checkpoints = memoryStore();
  return { checkpointStore: state.checkpoints.store };
});
vi.mock("@/lib/quiz/repository", async () => {
  const { memoryQuizStore } = await import("@/test/memory-quiz-store");
  state.quizzes = memoryQuizStore();
  return { quizStore: state.quizzes.store };
});
vi.mock("@/lib/plans/repository", () => ({ getPlan: async () => state.plan }));
vi.mock("@/lib/gemini/client", async () => {
  const { GeminiError } = await import("@/lib/gemini/errors");
  return {
    getGeminiModel: () => "test-model",
    getGeminiClient: () => {
      if (!state.geminiConfigured) throw new GeminiError("not_configured");
      return { models: { generateContent: (...a: unknown[]) => (state.gemini.generateContent as (...args: unknown[]) => unknown)(...a) } };
    },
  };
});
vi.mock("@/lib/github/client", () => ({ getGitHubClient: () => ({ compareCommits: async () => state.compare }) }));
vi.mock("@/lib/db/supabase", () => ({ StorageConfigError: class extends Error {} }));

import { NOTHING_READABLE, STRONG, WEEK } from "@/lib/evaluation/fixtures";
import { modelQuiz } from "@/lib/quiz/fixtures";
import { POST as attempt } from "./attempt/route";
import { GET, POST } from "./route";

const id = "123e4567-e89b-42d3-a456-426614174000";
const sha = (c: string) => c.repeat(40);
const ctx = (week: string, projectId = id) => ({ params: Promise.resolve({ id: projectId, week }) }) as never;
const post = () => new Request("http://localhost/x", { method: "POST" });
const get = () => new Request("http://localhost/x");
const send = (body: unknown) =>
  new Request("http://localhost/x", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

const diffOf = (snapshot: typeof STRONG) => ({ ...snapshot, status: "ahead", isEmpty: false });

beforeEach(async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  state.duration = 12;
  (state.checkpoints.checkpoints as unknown[]).length = 0;
  state.quizzes.quizzes.length = 0;
  state.quizzes.attempts.length = 0;
  state.geminiConfigured = true;
  state.compare = diffOf(STRONG);
  state.plan = {
    projectId: id,
    model: "m",
    generatedAt: "2026-10-27T10:00:00+00:00",
    plan: Array.from({ length: 12 }, (_, i) => ({ ...WEEK, weekNumber: i + 1 })),
  };
  state.gemini.generateContent = vi.fn(async () => ({ text: JSON.stringify(modelQuiz()) }));
  await (state.checkpoints.store as { insertCheckpoint: (c: unknown) => Promise<unknown> }).insertCheckpoint({
    projectId: id,
    weekNumber: 1,
    commitSha: sha("1"),
    baseCommitSha: sha("0"),
    branch: "main",
    filesChanged: 2,
    additions: 20,
    deletions: 0,
  });
});

/** The correct answers of the stored quiz, which the browser never gets before an attempt. */
const rightAnswers = () => state.quizzes.quizzes[0].questions.map((q) => q.correctIndex);

describe("POST /api/projects/[id]/weeks/[week]/quiz", () => {
  it("creates the quiz (201) and returns questions and options only", async () => {
    const res = await POST(post(), ctx("1"));
    expect(res.status).toBe(201);
    const text = await res.text();
    const body = JSON.parse(text);
    expect(body.quiz).toMatchObject({ state: "open", weekNumber: 1 });
    expect(body.quiz.questions).toHaveLength(5);
    expect(text).not.toMatch(/correctIndex|explanation|Because part/);
    expect(state.quizzes.quizzes).toHaveLength(1);
  });

  it.each(["0", "17", "abc", "1.5", "-1", ""])("rejects week %j with 400 before any work", async (week) => {
    expect((await POST(post(), ctx(week))).status).toBe(400);
    expect(state.gemini.generateContent).not.toHaveBeenCalled();
  });

  it("the project's own duration limits the weeks", async () => {
    state.duration = 3;
    const res = await POST(post(), ctx("4"));
    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toMatch(/lasts 3 weeks/);
    expect(state.gemini.generateContent).not.toHaveBeenCalled();
  });

  it("400 for a project id that is not a UUID", async () => {
    expect((await POST(post(), ctx("1", "nope"))).status).toBe(400);
  });

  it("409 checkpoint_required for a week that was not recorded", async () => {
    const res = await POST(post(), ctx("2"));
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("checkpoint_required");
  });

  it("409 plan_required when the project has no plan", async () => {
    state.plan = null;
    const res = await POST(post(), ctx("1"));
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("plan_required");
  });

  it("409 nothing_to_ask when the week has no readable code", async () => {
    state.compare = diffOf(NOTHING_READABLE);
    const res = await POST(post(), ctx("1"));
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("nothing_to_ask");
    expect(state.gemini.generateContent).not.toHaveBeenCalled();
  });

  it("409 quiz_exists the second time, and the questions are not replaced", async () => {
    expect((await POST(post(), ctx("1"))).status).toBe(201);
    const first = JSON.stringify(state.quizzes.quizzes[0].questions);
    state.gemini.generateContent = vi.fn(async () => ({ text: JSON.stringify(modelQuiz()) }));
    const again = await POST(post(), ctx("1"));
    expect(again.status).toBe(409);
    expect((await again.json()).error.code).toBe("quiz_exists");
    expect(state.gemini.generateContent).not.toHaveBeenCalled();
    expect(JSON.stringify(state.quizzes.quizzes[0].questions)).toBe(first);
  });

  it("simultaneous requests: exactly one 201", async () => {
    const results = await Promise.all(Array.from({ length: 5 }, () => POST(post(), ctx("1"))));
    expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409, 409, 409]);
    expect(state.quizzes.quizzes).toHaveLength(1);
  });

  it("503 before any work when Gemini is not configured", async () => {
    state.geminiConfigured = false;
    const res = await POST(post(), ctx("1"));
    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe("gemini_not_configured");
  });

  it.each([
    ["rate_limited", 429],
    ["quota_exhausted", 429],
    ["timeout", 504],
    ["unavailable", 502],
  ] as const)("maps a Gemini %s failure to %i and stores nothing", async (code, status) => {
    state.gemini.generateContent = vi.fn(async () => {
      throw new GeminiError(code);
    });
    const res = await POST(post(), ctx("1"));
    expect(res.status).toBe(status);
    expect(state.quizzes.quizzes).toHaveLength(0);
  });

  it("502 when the model keeps returning an invalid quiz, storing nothing", async () => {
    state.gemini.generateContent = vi.fn(async () => ({ text: "not json" }));
    const res = await POST(post(), ctx("1"));
    expect(res.status).toBe(502);
    expect((await res.json()).error.code).toBe("gemini_invalid_response");
    expect(state.quizzes.quizzes).toHaveLength(0);
  });
});

describe("GET /api/projects/[id]/weeks/[week]/quiz", () => {
  it("returns { quiz: null } before a quiz exists", async () => {
    const res = await GET(get(), ctx("1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ quiz: null });
  });

  it("returns the open quiz with no answers or explanations", async () => {
    await POST(post(), ctx("1"));
    const text = await (await GET(get(), ctx("1"))).text();
    expect(JSON.parse(text).quiz.state).toBe("open");
    expect(text).not.toMatch(/correctIndex|explanation|Because part/);
  });

  it("returns the full review after the attempt", async () => {
    await POST(post(), ctx("1"));
    await attempt(send({ answers: rightAnswers() }), ctx("1"));
    const body = await (await GET(get(), ctx("1"))).json();
    expect(body.quiz).toMatchObject({ state: "taken", correctCount: 5, total: 5 });
    expect(body.quiz.questions[0]).toHaveProperty("explanation");
    expect(body.quiz.questions[0]).toHaveProperty("correctIndex");
  });

  it("rejects bad ids and weeks", async () => {
    expect((await GET(get(), ctx("abc"))).status).toBe(400);
    expect((await GET(get(), ctx("1", "nope"))).status).toBe(400);
  });
});

describe("POST /api/projects/[id]/weeks/[week]/quiz/attempt", () => {
  beforeEach(async () => {
    await POST(post(), ctx("1"));
  });

  it("grades on the server (201) and reveals the correct answers and explanations only now", async () => {
    const answers = rightAnswers().map((right, i) => (i < 3 ? right : (right + 1) % 4));
    const res = await attempt(send({ answers }), ctx("1"));
    expect(res.status).toBe(201);
    const { quiz } = await res.json();
    expect(quiz).toMatchObject({ state: "taken", correctCount: 3, total: 5 });
    expect(quiz.questions.map((q: { chosenIndex: number }) => q.chosenIndex)).toEqual(answers);
    expect(quiz.questions.every((q: { explanation: string }) => q.explanation.length > 0)).toBe(true);
    expect(state.quizzes.attempts).toHaveLength(1);
  });

  it("ignores any score the browser sends: it refuses extra fields", async () => {
    const res = await attempt(send({ answers: rightAnswers(), correctCount: 5 }), ctx("1"));
    expect(res.status).toBe(400);
    expect(state.quizzes.attempts).toHaveLength(0);
  });

  it.each([
    [{ answers: [0, 1, 2, 3] }],
    [{ answers: [0, 1, 2, 3, 9] }],
    [{ answers: "0,1,2,3,0" }],
    [{}],
    [[0, 1, 2, 3, 0]],
    [null],
  ])("400 invalid_answers for %j, saving nothing", async (body) => {
    const res = await attempt(send(body), ctx("1"));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("invalid_answers");
    expect(state.quizzes.attempts).toHaveLength(0);
  });

  it("400 invalid_json for a body that is not JSON", async () => {
    const res = await attempt(new Request("http://localhost/x", { method: "POST", body: "nope" }), ctx("1"));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("invalid_json");
  });

  it("409 already_attempted on the second submission, keeping the first result", async () => {
    expect((await attempt(send({ answers: rightAnswers() }), ctx("1"))).status).toBe(201);
    const again = await attempt(send({ answers: [0, 0, 0, 0, 0] }), ctx("1"));
    expect(again.status).toBe(409);
    expect((await again.json()).error.code).toBe("already_attempted");
    expect(state.quizzes.attempts).toHaveLength(1);
    expect(state.quizzes.attempts[0]).toMatchObject({ correctCount: 5 });
  });

  it("simultaneous submissions: exactly one 201", async () => {
    const results = await Promise.all(Array.from({ length: 5 }, () => attempt(send({ answers: rightAnswers() }), ctx("1"))));
    expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409, 409, 409]);
    expect(state.quizzes.attempts).toHaveLength(1);
  });

  it("404 quiz_not_found for a recorded week that has no quiz", async () => {
    await (state.checkpoints.store as { insertCheckpoint: (c: unknown) => Promise<unknown> }).insertCheckpoint({
      projectId: id,
      weekNumber: 2,
      commitSha: sha("2"),
      baseCommitSha: sha("1"),
      branch: "main",
      filesChanged: 1,
      additions: 5,
      deletions: 0,
    });
    const res = await attempt(send({ answers: rightAnswers() }), ctx("2"));
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("quiz_not_found");
  });

  it("409 checkpoint_required for an unrecorded week, and 400 for bad weeks", async () => {
    expect((await attempt(send({ answers: rightAnswers() }), ctx("3"))).status).toBe(409);
    expect((await attempt(send({ answers: rightAnswers() }), ctx("0"))).status).toBe(400);
  });
});
