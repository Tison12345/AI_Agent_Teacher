import { beforeEach, describe, expect, it, vi } from "vitest";
import { OTHER_PROJECT, PROJECT, reviewWorld } from "@/test/review-fixtures";

const state = vi.hoisted(() => ({ world: undefined as unknown as ReturnType<typeof reviewWorld> }));

vi.mock("@/lib/review/repository", () => ({
  reviewStore: {
    list: (...a: unknown[]) => (state.world.review.store.list as (...x: unknown[]) => unknown)(...a),
    getDetail: (...a: unknown[]) => (state.world.review.store.getDetail as (...x: unknown[]) => unknown)(...a),
    decide: (...a: unknown[]) => (state.world.review.store.decide as (...x: unknown[]) => unknown)(...a),
    listResults: (...a: unknown[]) => (state.world.review.store.listResults as (...x: unknown[]) => unknown)(...a),
  },
}));
vi.mock("@/lib/projects/repository", () => ({
  getProject: vi.fn(async (id: string) => (id === PROJECT || id === OTHER_PROJECT ? { id } : null)),
  RepositoryError: class extends Error {},
}));
vi.mock("@/lib/db/supabase", () => ({ StorageConfigError: class extends Error {} }));
// The decision wakes the paused evaluation workflow; here that is a recorded call, never a database connection.
const workflow = vi.hoisted(() => ({ resumeAfterDecision: vi.fn(async () => {}) }));
vi.mock("@/lib/workflow/evaluation", () => ({ getEvaluationRunner: () => workflow }));

import { GET as getResults } from "../../projects/[id]/results/route";
import { GET as getDetail } from "./[id]/route";
import { POST as postDecision } from "./[id]/decision/route";
import { GET as getQueue } from "./route";

const idCtx = (id: string) => ({ params: Promise.resolve({ id }) }) as never;
const queue = (qs = "") => getQueue(new Request(`http://localhost/api/faculty/evaluations${qs}`));
const decide = (id: string, body: unknown, raw?: string) =>
  postDecision(
    new Request("http://localhost/x", { method: "POST", body: raw ?? JSON.stringify(body) }),
    idCtx(id) as never,
  );
const results = (id = PROJECT) => getResults(new Request("http://localhost/x"), idCtx(id) as never);

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  state.world = reviewWorld();
});

describe("GET /api/faculty/evaluations", () => {
  it("lists pending evaluations by default, with the AI's suggestion labelled for teachers", async () => {
    await state.world.seed(1);
    await state.world.seed(2, [20, 10, 5]);
    const res = await queue();
    expect(res.status).toBe(200);
    const { evaluations } = await res.json();
    expect(evaluations).toHaveLength(2);
    expect(evaluations[0]).toMatchObject({ projectTitle: "Library app", weekNumber: 1, status: "pending_review", suggestedScore: 94, confidence: "high" });
  });

  it("filters by status and moves decided items out of the pending queue", async () => {
    const { evaluation } = await state.world.seed(1);
    await state.world.seed(2);
    await decide(evaluation.id, { decision: "approve" });
    expect((await (await queue()).json()).evaluations).toHaveLength(1);
    expect((await (await queue("?status=approved")).json()).evaluations).toHaveLength(1);
    expect((await (await queue("?status=all")).json()).evaluations).toHaveLength(2);
  });

  it("rejects an unknown status filter", async () => {
    expect((await queue("?status=bogus")).status).toBe(400);
  });
});

describe("GET /api/faculty/evaluations/[id]", () => {
  it("returns the evaluation, the diff the AI saw, the project and no decision yet", async () => {
    const { evaluation } = await state.world.seed(1);
    const res = await getDetail(new Request("http://localhost/x"), idCtx(evaluation.id));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.evaluation.suggestedScore).toBe(94);
    expect(body.snapshot.files[0].patch).toContain("function addBook");
    expect(body.project).toMatchObject({ id: PROJECT, title: "Library app" });
    expect(body.decision).toBeNull();
  });

  it("400 for a malformed id and 404 for an unknown one", async () => {
    expect((await getDetail(new Request("http://localhost/x"), idCtx("nope"))).status).toBe(400);
    expect((await getDetail(new Request("http://localhost/x"), idCtx("00000000-0000-4000-8000-00000000dead"))).status).toBe(404);
  });
});

describe("POST /api/faculty/evaluations/[id]/decision", () => {
  it("approve → 201, official score equals the AI's, status becomes approved", async () => {
    const { evaluation } = await state.world.seed(1);
    const res = await decide(evaluation.id, { decision: "approve" });
    expect(res.status).toBe(201);
    expect((await res.json()).decision).toMatchObject({ decision: "approve", approvedScore: 94 });
    const detail = await (await getDetail(new Request("http://localhost/x"), idCtx(evaluation.id))).json();
    expect(detail.evaluation.status).toBe("approved");
    expect(detail.decision.decision).toBe("approve");
  });

  it("edit and reject → 201", async () => {
    const a = await state.world.seed(1);
    const b = await state.world.seed(2);
    expect((await decide(a.evaluation.id, { decision: "edit", approvedScore: 60, approvedFeedback: "Do X.", comment: "why" })).status).toBe(201);
    expect((await decide(b.evaluation.id, { decision: "reject", comment: "unreliable" })).status).toBe(201);
  });

  it.each([
    ["not JSON", undefined, "{oops"],
    ["empty body", {}, undefined],
    ["unknown decision", { decision: "maybe" }, undefined],
    ["edit with no comment", { decision: "edit", approvedScore: 50, approvedFeedback: "x" }, undefined],
    ["score out of range", { decision: "edit", approvedScore: 101, approvedFeedback: "x", comment: "c" }, undefined],
    ["approve smuggling a score", { decision: "approve", approvedScore: 100 }, undefined],
  ])("400 for %s, and nothing is recorded", async (_label, body, raw) => {
    const { evaluation } = await state.world.seed(1);
    const res = await decide(evaluation.id, body, raw);
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("invalid_decision");
    expect(state.world.review.decisions).toHaveLength(0);
  });

  it("422 for an edit that changes nothing", async () => {
    const { evaluation } = await state.world.seed(1);
    const same = {
      decision: "edit",
      approvedScore: evaluation.suggestedScore,
      approvedFeedback: evaluation.feedbackForNextWeek.map((f) => `- ${f}`).join("\n"),
      comment: "same",
    };
    const res = await decide(evaluation.id, same);
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe("unchanged_edit");
  });

  it("409 when already decided: the first decision stands", async () => {
    const { evaluation } = await state.world.seed(1);
    expect((await decide(evaluation.id, { decision: "approve" })).status).toBe(201);
    const again = await decide(evaluation.id, { decision: "reject", comment: "late" });
    expect(again.status).toBe(409);
    expect((await again.json()).error.code).toBe("already_decided");
    expect(state.world.review.decisions).toHaveLength(1);
  });

  it("simultaneous clicks record exactly one decision", async () => {
    const { evaluation } = await state.world.seed(1);
    const responses = await Promise.all(Array.from({ length: 6 }, () => decide(evaluation.id, { decision: "approve" })));
    expect(responses.map((r) => r.status).sort()).toEqual([201, 409, 409, 409, 409, 409]);
    expect(state.world.review.decisions).toHaveLength(1);
  });

  it("400 for a malformed id, 404 for an unknown evaluation", async () => {
    expect((await decide("nope", { decision: "approve" })).status).toBe(400);
    expect((await decide("00000000-0000-4000-8000-00000000dead", { decision: "approve" })).status).toBe(404);
  });
});

describe("GET /api/projects/[id]/results (what the student sees)", () => {
  it("is empty until a teacher decides", async () => {
    await state.world.seed(1);
    expect(await (await results()).json()).toEqual({ results: [] });
  });

  it("shows the official score and feedback only, never the AI's suggestion or the comment", async () => {
    const a = await state.world.seed(1, [36, 30, 28]);
    const b = await state.world.seed(2, [10, 5, 0]);
    const c = await state.world.seed(3);
    await decide(a.evaluation.id, { decision: "edit", approvedScore: 71.5, approvedFeedback: "Add validation.", comment: "PRIVATE-NOTE" });
    await decide(b.evaluation.id, { decision: "reject", comment: "PRIVATE-REASON" });
    const res = await results();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.results).toEqual([
      { weekNumber: 1, outcome: "edited", officialScore: 71.5, feedback: "Add validation.", decidedAt: expect.any(String) },
      { weekNumber: 2, outcome: "rejected", officialScore: null, feedback: null, decidedAt: expect.any(String) },
    ]);
    const text = JSON.stringify(body);
    expect(text).not.toMatch(/PRIVATE|94|suggested|confidence|criteri|concern/i);
    expect(body.results.some((r: { weekNumber: number }) => r.weekNumber === 3)).toBe(false); // pending: not shown
    void c;
  });

  it("does not show another project's results", async () => {
    const other = await state.world.seed(1, [36, 30, 28], OTHER_PROJECT);
    await decide(other.evaluation.id, { decision: "approve" });
    expect(await (await results()).json()).toEqual({ results: [] });
  });

  it("400 for a malformed id and 404 for an unknown project", async () => {
    expect((await results("nope")).status).toBe(400);
    expect((await results("323e4567-e89b-42d3-a456-426614174000")).status).toBe(404);
  });
});
