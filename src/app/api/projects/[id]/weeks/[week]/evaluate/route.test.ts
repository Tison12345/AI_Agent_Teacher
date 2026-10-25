import { beforeEach, describe, expect, it, vi } from "vitest";
import { GeminiError } from "@/lib/gemini/errors";

const state = vi.hoisted(() => ({
  checkpoints: undefined as unknown as { store: unknown; checkpoints: unknown[] },
  evaluations: undefined as unknown as { store: unknown; rows: unknown[] },
  plan: null as unknown,
  gemini: { generateContent: undefined as unknown as ReturnType<typeof vi.fn> },
  geminiConfigured: true,
  compare: undefined as unknown,
}));

vi.mock("@/lib/projects/repository", () => ({
  getProject: vi.fn(async () => ({ id: "x", repoUrl: "https://github.com/octocat/hello-world" })),
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
import { POST } from "./route";

const id = "123e4567-e89b-42d3-a456-426614174000";
const sha = (c: string) => c.repeat(40);
const req = new Request("http://localhost/x", { method: "POST" });
const ctx = (week: string, projectId = id) => ({ params: Promise.resolve({ id: projectId, week }) }) as never;

const diff = {
  ...STRONG,
  status: "ahead",
  isEmpty: false,
  files: STRONG.files,
};

beforeEach(async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  (state.checkpoints.checkpoints as unknown[]).length = 0;
  (state.evaluations.rows as unknown[]).length = 0;
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
  it("creates the evaluation (201) and says only that it was submitted for review: no score", async () => {
    const res = await POST(req, ctx("1"));
    expect(res.status).toBe(201);
    const text = await res.text();
    expect(JSON.parse(text).evaluation).toMatchObject({ weekNumber: 1, status: "pending_review" });
    expect(text).not.toMatch(/score|suggested|criteri|confidence|rationale|evidence/i);
    expect(state.evaluations.rows).toHaveLength(1);
  });

  it.each(["0", "13", "abc", "1.5", "-1", ""])("rejects week %j with 400", async (week) => {
    expect((await POST(req, ctx(week))).status).toBe(400);
    expect(state.gemini.generateContent).not.toHaveBeenCalled();
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
    expect((await POST(req, ctx("1"))).status).toBe(201);
    state.gemini.generateContent = vi.fn(async () => ({ text: JSON.stringify(modelAnswer([0, 0, 0])) }));
    const again = await POST(req, ctx("1"));
    expect(again.status).toBe(409);
    const text = await again.text();
    expect(JSON.parse(text)).toMatchObject({ error: { code: "evaluation_exists" }, status: "pending_review" });
    expect(text).not.toMatch(/score/i);
    expect(state.gemini.generateContent).not.toHaveBeenCalled();
    expect(state.evaluations.rows).toHaveLength(1);
  });

  it("simultaneous requests: exactly one 201", async () => {
    const results = await Promise.all(Array.from({ length: 5 }, () => POST(req, ctx("1"))));
    expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409, 409, 409]);
    expect(state.evaluations.rows).toHaveLength(1);
  });

  it("503 before any work when Gemini is not configured", async () => {
    state.geminiConfigured = false;
    const res = await POST(req, ctx("1"));
    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe("gemini_not_configured");
  });

  it.each([
    ["rate_limited", 429],
    ["timeout", 504],
    ["unavailable", 502],
  ] as const)("maps a Gemini %s failure to %i and stores nothing", async (geminiCode, status) => {
    state.gemini.generateContent = vi.fn(async () => {
      throw new GeminiError(geminiCode);
    });
    const res = await POST(req, ctx("1"));
    expect(res.status).toBe(status);
    expect(state.evaluations.rows).toHaveLength(0);
  });

  it("502 when the model keeps returning an invalid evaluation, storing nothing", async () => {
    state.gemini.generateContent = vi.fn(async () => ({ text: "not json" }));
    const res = await POST(req, ctx("1"));
    expect(res.status).toBe(502);
    expect((await res.json()).error.code).toBe("gemini_invalid_response");
    expect(state.evaluations.rows).toHaveLength(0);
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
