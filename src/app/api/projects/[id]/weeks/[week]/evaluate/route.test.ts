import { beforeEach, describe, expect, it, vi } from "vitest";
import { GeminiError } from "@/lib/gemini/errors";

const state = vi.hoisted(() => ({
  duration: 12,
  checkpoints: undefined as unknown as { store: unknown; checkpoints: unknown[] },
  evaluations: undefined as unknown as { store: unknown; rows: unknown[] },
  plan: null as unknown,
  gemini: { generateContent: undefined as unknown as ReturnType<typeof vi.fn> },
  geminiConfigured: true,
  compare: undefined as unknown,
  /** The evaluation workflow runner for the current test, and the runs it was asked to start. */
  runner: undefined as undefined | { start(target: never): Promise<unknown>; progress(key: string): Promise<unknown> },
  runs: [] as Promise<unknown>[],
  held: new Set<string>(),
  resumed: [] as string[],
}));

// The real evaluation graph on a memory checkpointer, with a lease store that lets one run hold a thread at a time.
vi.mock("@/lib/workflow/evaluation", async () => {
  const { MemorySaver } = await import("@langchain/langgraph");
  const { buildEvaluationGraph } = await import("@/lib/workflow/evaluation/graph");
  const { defaultEvaluationGraphDeps } = await import("@/lib/workflow/evaluation/repository");
  const { createEvaluationRunner } = await import("@/lib/workflow/evaluation/runner");
  return {
    getEvaluationRunner: () =>
      (state.runner ??= createEvaluationRunner({
        graph: buildEvaluationGraph(defaultEvaluationGraphDeps(), new MemorySaver()),
        leases: {
          claim: async (thread) => (state.held.has(thread) ? false : (state.held.add(thread), true)),
          renew: async () => true,
          release: async (thread) => state.held.delete(thread),
        },
        sleep: async () => {},
      }) as never),
    resumeEvaluationInBackground: (_runner: unknown, checkpointId: string) => {
      state.resumed.push(checkpointId);
    },
    startEvaluationInBackground: (runner: { start(target: never): Promise<unknown> }, target: never) => {
      state.runs.push(runner.start(target).catch(() => {}));
    },
  };
});

vi.mock("@/lib/projects/repository", () => ({
  getProject: vi.fn(async () => ({ id: "x", repoUrl: "https://github.com/octocat/hello-world", durationWeeks: state.duration })),
}));
vi.mock("@/lib/checkpoints/repository", async () => {
  const { memoryStore } = await import("@/test/memory-checkpoint-store");
  state.checkpoints = memoryStore();
  return { checkpointStore: state.checkpoints.store };
});
vi.mock("@/lib/evaluation/repository", async () => {
  const { memoryEvaluationStore } = await import("@/test/memory-evaluation-store");
  state.evaluations = memoryEvaluationStore();
  return { evaluationStore: state.evaluations.store };
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

import { STRONG, WEEK, modelAnswer } from "@/lib/evaluation/fixtures";
import { GET as getEvaluation } from "../evaluation/route";
import { GET as getWorkflow, POST as resumeRoute } from "../workflow/route";
import { POST as startRoute } from "./route";

const id = "123e4567-e89b-42d3-a456-426614174000";
const sha = (c: string) => c.repeat(40);
const req = new Request("http://localhost/x", { method: "POST" });
const ctx = (week: string, projectId = id) => ({ params: Promise.resolve({ id: projectId, week }) }) as never;

/** Starts the evaluation and waits for the background run to end. */
const POST = async (request: Request, context: ReturnType<typeof ctx>) => {
  const res = await startRoute(request, context);
  await Promise.all(state.runs.splice(0));
  return res;
};
const progressOf = async (week = "1") => (await (await getWorkflow(new Request("http://localhost/x"), ctx(week))).json()).progress;

const diff = {
  ...STRONG,
  status: "ahead",
  isEmpty: false,
  files: STRONG.files,
};

beforeEach(async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  state.duration = 12;
  (state.checkpoints.checkpoints as unknown[]).length = 0;
  (state.evaluations.rows as unknown[]).length = 0;
  state.runner = undefined;
  state.runs = [];
  state.held.clear();
  state.resumed = [];
  state.geminiConfigured = true;
  state.compare = diff;
  state.plan = {
    projectId: id,
    model: "m",
    generatedAt: "2026-10-26T10:00:00+00:00",
    plan: Array.from({ length: 12 }, (_, i) => ({ ...WEEK, weekNumber: i + 1 })),
  };
  state.gemini.generateContent = vi.fn(async () => ({ text: JSON.stringify(modelAnswer([36, 30, 28])) }));
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

describe("POST /api/projects/[id]/weeks/[week]/evaluate", () => {
  it("starts the evaluation (202) without any score; it ends waiting for the teacher", async () => {
    const res = await POST(req, ctx("1"));
    expect(res.status).toBe(202);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ workflow: { state: "running", afterRun: 0 } });
    expect(text).not.toMatch(/score|suggested|criteri|confidence|rationale|evidence/i);
    expect(state.evaluations.rows).toHaveLength(1);
    expect(await progressOf()).toMatchObject({ state: "waiting_faculty", run: 1, failure: null });
  });

  it.each(["0", "13", "abc", "1.5", "-1", ""])("rejects week %j with 400", async (week) => {
    expect((await POST(req, ctx(week))).status).toBe(400);
    expect(state.gemini.generateContent).not.toHaveBeenCalled();
  });

  it("the project's own duration limits the weeks, before any GitHub or AI work", async () => {
    state.duration = 3;
    const res = await POST(req, ctx("4"));
    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toMatch(/lasts 3 weeks/);
    expect(state.gemini.generateContent).not.toHaveBeenCalled();
    state.duration = 16;
    expect((await POST(req, ctx("13"))).status).toBe(409); // allowed week, just not recorded
  });

  it("409 checkpoint_required for a week that was not recorded", async () => {
    const res = await POST(req, ctx("2"));
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("checkpoint_required");
  });

  it("409 plan_required when the project has no plan", async () => {
    state.plan = null;
    const res = await POST(req, ctx("1"));
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("plan_required");
  });

  it("409 evaluation_exists the second time, with the status but no score, and nothing replaced", async () => {
    expect((await POST(req, ctx("1"))).status).toBe(202);
    state.gemini.generateContent = vi.fn(async () => ({ text: JSON.stringify(modelAnswer([0, 0, 0])) }));
    const again = await POST(req, ctx("1"));
    expect(again.status).toBe(409);
    const text = await again.text();
    expect(JSON.parse(text)).toMatchObject({ error: { code: "evaluation_exists" }, status: "pending_review" });
    expect(text).not.toMatch(/score/i);
    expect(state.gemini.generateContent).not.toHaveBeenCalled();
    expect(state.evaluations.rows).toHaveLength(1);
  });

  it("simultaneous requests: exactly one evaluation is made, and one run holds the thread at a time", async () => {
    const results = await Promise.all(Array.from({ length: 5 }, () => POST(req, ctx("1"))));
    expect(results.map((r) => r.status).filter((status) => status === 202).length).toBeGreaterThanOrEqual(1);
    expect(results.every((r) => r.status === 202 || r.status === 409)).toBe(true);
    expect(state.evaluations.rows).toHaveLength(1);
    expect(state.gemini.generateContent).toHaveBeenCalledTimes(1);
    expect((await progressOf()).state).toBe("waiting_faculty");
  });

  it("503 before any work when Gemini is not configured", async () => {
    state.geminiConfigured = false;
    const res = await POST(req, ctx("1"));
    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe("gemini_not_configured");
  });

  it.each([
    ["rate_limited", "ai_rate_limited", 1],
    ["quota_exhausted", "ai_quota", 1],
    ["timeout", "ai_unavailable", 2], // a timeout or a 503 is tried once more; a rate limit never is
    ["unavailable", "ai_unavailable", 2],
  ] as const)("a Gemini %s failure ends the run as %s after %i call(s) and stores nothing", async (geminiCode, failureCode, calls) => {
    state.gemini.generateContent = vi.fn(async () => {
      throw new GeminiError(geminiCode);
    });
    const res = await POST(req, ctx("1"));
    expect(res.status).toBe(202);
    expect(await progressOf()).toMatchObject({ state: "failed", failure: { code: failureCode } });
    expect(state.gemini.generateContent).toHaveBeenCalledTimes(calls);
    expect(state.evaluations.rows).toHaveLength(0);
  });

  it("a model that keeps returning an invalid evaluation ends the run as ai_invalid after two tries, storing nothing", async () => {
    state.gemini.generateContent = vi.fn(async () => ({ text: "not json" }));
    expect((await POST(req, ctx("1"))).status).toBe(202);
    expect(await progressOf()).toMatchObject({ state: "failed", failure: { code: "ai_invalid" } });
    expect(state.gemini.generateContent).toHaveBeenCalledTimes(2);
    expect(state.evaluations.rows).toHaveLength(0);
  });

  it("a failed evaluation can be started again as a new run", async () => {
    state.gemini.generateContent = vi.fn(async () => ({ text: "not json" }));
    await POST(req, ctx("1"));
    expect(await progressOf()).toMatchObject({ state: "failed", run: 1 });
    state.gemini.generateContent = vi.fn(async () => ({ text: JSON.stringify(modelAnswer([36, 30, 28])) }));
    const again = await POST(req, ctx("1"));
    expect(again.status).toBe(202);
    expect((await again.json()).workflow.afterRun).toBe(1);
    expect(await progressOf()).toMatchObject({ state: "waiting_faculty", run: 2, failure: null });
    expect(state.evaluations.rows).toHaveLength(1);
  });
});

describe("GET /api/projects/[id]/weeks/[week]/workflow", () => {
  it("is not started for a recorded week that was never evaluated, and for a week that was never recorded", async () => {
    expect(await progressOf("1")).toMatchObject({ state: "not_started", run: 0 });
    expect(await progressOf("2")).toMatchObject({ state: "not_started", run: 0 });
  });

  it("never contains the AI's score, feedback or the code", async () => {
    await POST(req, ctx("1"));
    const res = await getWorkflow(new Request("http://localhost/x"), ctx("1"));
    const text = await res.text();
    expect(text).not.toMatch(/score|suggested|addBook|rationale|evidence|confidence/i);
    expect(Object.keys(JSON.parse(text).progress).sort()).toEqual(["failure", "run", "state", "steps"]);
  });

  it("rejects bad ids, weeks and unknown projects", async () => {
    expect((await getWorkflow(new Request("http://localhost/x"), ctx("abc"))).status).toBe(400);
    expect((await getWorkflow(new Request("http://localhost/x"), ctx("1", "nope"))).status).toBe(400);
  });
});

describe("GET /api/projects/[id]/weeks/[week]/evaluation", () => {
  const get = (week: string) => getEvaluation(new Request("http://localhost/x"), ctx(week));

  it("404 before an evaluation exists", async () => {
    expect((await get("1")).status).toBe(404);
  });

  it("returns the full evaluation for review, with file summaries but no code", async () => {
    await POST(req, ctx("1"));
    const res = await get("1");
    expect(res.status).toBe(200);
    const text = await res.text();
    const body = JSON.parse(text);
    expect(body.evaluation).toMatchObject({ suggestedScore: 94, status: "pending_review", model: "test-model" });
    expect(body.evaluation.criteriaAssessments).toHaveLength(3);
    expect(body.evaluation.reviewScope.codeExecuted).toBe(false);
    expect(body.snapshot.files[0]).toMatchObject({ path: "src/app.js", patchIncluded: true });
    expect(text).not.toContain("function addBook"); // patch text stays in the database
  });

  it("rejects bad ids and weeks", async () => {
    expect((await get("abc")).status).toBe(400);
    expect((await getEvaluation(new Request("http://localhost/x"), ctx("1", "nope"))).status).toBe(400);
  });
});

describe("POST /api/projects/[id]/weeks/[week]/workflow (continue a stalled run)", () => {
  const resume = (week = "1", projectId = id) => resumeRoute(new Request("http://localhost/x", { method: "POST" }), ctx(week, projectId));

  it("leaves a run that is not stalled alone (409), including a week with no workflow", async () => {
    expect((await resume()).status).toBe(409); // recorded, never evaluated
    await POST(req, ctx("1"));
    const res = await resume(); // paused for the teacher
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("not_stalled");
    expect((await resume("2")).status).toBe(409); // not recorded
    expect(state.resumed).toEqual([]);
  });

  it("rejects bad ids and weeks", async () => {
    expect((await resume("abc")).status).toBe(400);
    expect((await resume("1", "nope")).status).toBe(400);
  });
});
