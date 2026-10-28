// @vitest-environment node
import { MemorySaver } from "@langchain/langgraph";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { STRONG } from "@/lib/evaluation/fixtures";
import { GeminiError } from "@/lib/gemini/errors";
import { GitHubError } from "@/lib/github/errors";
import { badAnswer, evaluationHarness, goodAnswer, toDiff, type Script } from "@/test/evaluation-workflow";
import type { LeaseStore } from "../lease";
import { buildEvaluationGraph } from "./graph";
import { createEvaluationRunner, evaluationThread } from "./runner";

type Options = Parameters<typeof evaluationHarness>[0] & {
  lease?: Partial<LeaseStore>;
  weeks?: number[];
  isLeased?: (threadId: string) => Promise<boolean>;
};

async function setup(options: Options = {}) {
  const h = evaluationHarness(options);
  const recorded = [];
  for (const week of options.weeks ?? [1]) recorded.push(await h.record(week));
  const graph = buildEvaluationGraph(h.deps, new MemorySaver());
  const leases: LeaseStore = { claim: async () => true, renew: async () => true, release: async () => true, ...options.lease };
  const runner = createEvaluationRunner({
    graph,
    leases,
    sleep: async () => {},
    isLeased: options.isLeased,
    stalledAfterMs: 0,
    lease: { heartbeatMs: 10_000, selfAbortMs: 20_000, runDeadlineMs: 60_000 },
  });
  const checkpoint = recorded[recorded.length - 1];
  return { ...h, graph, runner, checkpoint, target: h.target(checkpoint), recorded };
}
const statusOf = (progress: { steps: { id: string; status: string }[] }) => Object.fromEntries(progress.steps.map((s) => [s.id, s.status]));

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("evaluation workflow: the normal path", () => {
  it("loads the week, fetches the recorded commit range, reviews, checks, stores it for review and pauses for the teacher", async () => {
    const t = await setup();
    expect((await t.runner.start(t.target)).outcome).toBe("running"); // paused, not finished

    // The diff is between the two recorded SHAs, with the evaluation limits and source-first ordering.
    expect(t.compareCommits).toHaveBeenCalledWith("octocat", "hello-world", "0".repeat(40), "1".repeat(40), expect.objectContaining({ maxFiles: 60 }), true, expect.anything());
    expect(t.evaluations.rows).toHaveLength(1);
    expect(t.evaluations.rows[0].evaluation).toMatchObject({ weekNumber: 1, suggestedScore: 94, status: "pending_review", model: "eval-model" });
    expect(t.evaluations.rows[0].snapshot.files.map((f) => f.path)).toEqual(STRONG.files.map((f) => f.path));

    const progress = await t.runner.progress(t.checkpoint.id);
    expect(progress).toMatchObject({ state: "waiting_faculty", run: 1, failure: null });
    expect(statusOf(progress)).toEqual({
      load_context: "done",
      fetch_diff: "done",
      generate: "done",
      check_evaluation: "done",
      save_evaluation: "done",
      await_faculty: "waiting",
      finish: "pending",
    });
  });

  it("finishes after the teacher decides; the decision is read from the database, not taken from the wake-up", async () => {
    const t = await setup();
    await t.runner.start(t.target);
    t.decide(1);
    expect(await t.runner.resume(t.checkpoint.id)).toMatchObject({ resumed: true, outcome: "complete" });
    const progress = await t.runner.progress(t.checkpoint.id);
    expect(progress.state).toBe("complete");
    expect(progress.steps.every((step) => step.status === "done")).toBe(true);
  });

  it("a wake-up without a decision keeps waiting", async () => {
    const t = await setup();
    await t.runner.start(t.target);
    await t.runner.resume(t.checkpoint.id);
    expect((await t.runner.progress(t.checkpoint.id)).state).toBe("waiting_faculty");
    t.decide(1, "rejected");
    expect((await t.runner.resume(t.checkpoint.id)).outcome).toBe("complete");
  });

  it("week 2 is told week 1's title and what the earlier AI review found unfinished", async () => {
    const t = await setup({ weeks: [1, 2] });
    const first = t.recorded[0];
    await t.evaluations.store.insert({
      projectId: first.projectId,
      checkpointId: first.id,
      weekNumber: 1,
      model: "m",
      snapshot: STRONG,
      result: {
        suggestedScore: 70,
        criteriaAssessments: [{ criterion: "Add a book", score: 7, maxScore: 10, rationale: "ok", evidence: [] }],
        completedRequirements: [],
        incompleteRequirements: ["Sketch the screens"],
        technicalConcerns: [],
        feedbackForNextWeek: ["Keep going"],
        confidence: { level: "medium", uncertainties: [] },
        reviewScope: { filesChanged: 1, filesReviewed: 1, patchesTruncated: 0, notReviewed: [], filesBeyondLimit: 0, codeExecuted: false },
      },
    });
    await t.runner.start(t.target);
    const input = t.requestEvaluation.mock.calls[0][0] as { previous: unknown; weekNumber: number };
    expect(input.weekNumber).toBe(2);
    expect(input.previous).toEqual({ weekNumber: 1, title: "Plan the App", openItemsFromEarlierAiReview: ["Sketch the screens"] });
  });
});

describe("evaluation workflow: routing and retries", () => {
  it("an answer that fails the checks gets one corrected attempt, told what was wrong", async () => {
    const t = await setup({ gemini: [badAnswer(), goodAnswer()] });
    await t.runner.start(t.target);
    expect(t.requestEvaluation).toHaveBeenCalledTimes(2);
    expect(t.requestEvaluation.mock.calls[0][1]).toBeUndefined();
    expect(t.requestEvaluation.mock.calls[1][1]).toBeTruthy();
    expect(t.evaluations.rows).toHaveLength(1);
    expect((await t.runner.progress(t.checkpoint.id)).steps.find((s) => s.id === "generate")).toMatchObject({ status: "done", attempt: 2 });
  });

  it("two bad answers in a row end the run as ai_invalid, and nothing is stored", async () => {
    const t = await setup({ gemini: [badAnswer()] });
    expect((await t.runner.start(t.target)).outcome).toBe("failed");
    expect(t.requestEvaluation).toHaveBeenCalledTimes(2);
    expect(t.evaluations.rows).toHaveLength(0);
    const progress = await t.runner.progress(t.checkpoint.id);
    expect(progress).toMatchObject({ state: "failed", failure: { code: "ai_invalid" } });
    expect(statusOf(progress).check_evaluation).toBe("failed");
  });

  it("a timeout or a 503 is tried once more; the second try can succeed", async () => {
    const gemini: Script = [new GeminiError("timeout"), goodAnswer()];
    const t = await setup({ gemini });
    await t.runner.start(t.target);
    expect(t.requestEvaluation).toHaveBeenCalledTimes(2);
    expect(t.evaluations.rows).toHaveLength(1);
  });

  it("GitHub timing out is tried once more too", async () => {
    const t = await setup({ github: [new GitHubError("timeout"), toDiff(STRONG)] });
    await t.runner.start(t.target);
    expect(t.compareCommits).toHaveBeenCalledTimes(2);
    expect(t.evaluations.rows).toHaveLength(1);
  });

  it.each([
    ["rate_limited", "ai_rate_limited"],
    ["quota_exhausted", "ai_quota"],
    ["rejected", "ai_unavailable"],
    ["not_configured", "ai_unavailable"],
  ] as const)("Gemini %s is never tried again and ends the run as %s", async (code, failureCode) => {
    const t = await setup({ gemini: [new GeminiError(code)] });
    expect((await t.runner.start(t.target)).outcome).toBe("failed");
    expect(t.requestEvaluation).toHaveBeenCalledTimes(1);
    expect((await t.runner.progress(t.checkpoint.id)).failure?.code).toBe(failureCode);
  });

  it.each([
    ["rate_limited", "github_rate_limited"],
    ["not_found", "github_failed"],
    ["bad_credentials", "github_failed"],
  ] as const)("GitHub %s is never tried again, never reaches Gemini, and ends the run as %s", async (code, failureCode) => {
    const t = await setup({ github: [new GitHubError(code)] });
    expect((await t.runner.start(t.target)).outcome).toBe("failed");
    expect(t.compareCommits).toHaveBeenCalledTimes(1);
    expect(t.requestEvaluation).not.toHaveBeenCalled();
    expect((await t.runner.progress(t.checkpoint.id)).failure?.code).toBe(failureCode);
  });

  it("a checkpoint that already has an evaluation is refused as a precondition, before GitHub or Gemini", async () => {
    const t = await setup();
    await t.runner.start(t.target);
    t.decide(1);
    await t.runner.resume(t.checkpoint.id);
    expect((await t.runner.start(t.target)).outcome).toBe("failed");
    expect(t.evaluations.rows).toHaveLength(1);
    expect(t.compareCommits).toHaveBeenCalledTimes(1); // only the first run
    expect((await t.runner.progress(t.checkpoint.id))).toMatchObject({ state: "failed", failure: { code: "precondition" }, run: 2 });
  });

  it("a failed evaluation can be started again as a new run that shows only itself", async () => {
    const t = await setup({ gemini: [new GeminiError("rate_limited"), goodAnswer()] });
    await t.runner.start(t.target);
    expect((await t.runner.progress(t.checkpoint.id)).state).toBe("failed");
    await t.runner.start(t.target);
    const progress = await t.runner.progress(t.checkpoint.id);
    expect(progress).toMatchObject({ state: "waiting_faculty", run: 2, failure: null });
    expect(statusOf(progress).generate).toBe("done");
    expect(t.evaluations.rows).toHaveLength(1);
  });

  it("an unexpected error never leaks its details", async () => {
    const t = await setup();
    t.evaluations.store.insert = vi.fn().mockRejectedValue(new Error("connect ECONNREFUSED secret-host:5432 password=hunter2"));
    expect((await t.runner.start(t.target)).outcome).toBe("failed");
    const progress = await t.runner.progress(t.checkpoint.id);
    expect(progress.failure?.code).toBe("save_failed");
    expect(JSON.stringify(progress)).not.toMatch(/hunter2|ECONNREFUSED|secret-host/);
  });
});

describe("evaluation workflow: a repeated node does no harm", () => {
  it("a process that dies after the evaluation was stored continues from there, and stores nothing twice", async () => {
    const t = await setup();
    // The first process stores the evaluation, then cannot record anything more (its writes are refused).
    const realInsert = t.evaluations.store.insert.bind(t.evaluations.store);
    t.evaluations.store.insert = vi.fn(async (evaluation) => {
      await realInsert(evaluation);
      t.graph.updateState = vi.fn().mockRejectedValue(new Error("process died"));
      throw new Error("process died after the insert");
    });
    await t.runner.start(t.target);
    expect(t.evaluations.rows).toHaveLength(1);
    // The checkpoint is still at save_evaluation. A new process continues it.
    const stalled = await t.runner.progress(t.checkpoint.id);
    expect(statusOf(stalled)).toMatchObject({ generate: "done", check_evaluation: "done", save_evaluation: "active" });

    t.graph.updateState = Object.getPrototypeOf(t.graph).updateState.bind(t.graph);
    expect((await t.runner.resume(t.checkpoint.id)).resumed).toBe(true);
    expect(t.evaluations.rows).toHaveLength(1); // the stored row was found, not inserted again
    expect(t.compareCommits).toHaveBeenCalledTimes(1); // nothing before the failed step ran again
    expect(t.requestEvaluation).toHaveBeenCalledTimes(1);
    expect((await t.runner.progress(t.checkpoint.id)).state).toBe("waiting_faculty");
  });

  it("a decision made before the graph reaches the review step does not make it wait", async () => {
    const t = await setup();
    const realInsert = t.evaluations.store.insert.bind(t.evaluations.store);
    t.evaluations.store.insert = vi.fn(async (evaluation) => {
      const stored = await realInsert(evaluation);
      t.decide(1);
      return stored;
    });
    expect((await t.runner.start(t.target)).outcome).toBe("complete");
  });
});

describe("evaluation workflow: leases", () => {
  it("only one process runs a checkpoint: a second start is refused", async () => {
    const t = await setup({ lease: { claim: async () => false } });
    await expect(t.runner.start(t.target)).rejects.toMatchObject({ name: "LeaseHeldError" });
    expect(t.compareCommits).not.toHaveBeenCalled();
  });

  it("uses one thread per checkpoint", async () => {
    const t = await setup();
    expect(evaluationThread(t.checkpoint.id)).toBe(`evaluation:${t.checkpoint.id}`);
  });
});

describe("what the progress shows", () => {
  it("contains only step names and statuses, never the score, the AI's text, the code or the diff", async () => {
    const t = await setup();
    await t.runner.start(t.target);
    const text = JSON.stringify(await t.runner.progress(t.checkpoint.id));
    for (const secret of ["94", "suggested", "rationale", "evidence", "addBook", "function", "patch", "confidence", "feedbackForNextWeek", "criteria"]) {
      expect(text).not.toContain(secret);
    }
    expect(Object.keys(JSON.parse(text)).sort()).toEqual(["failure", "run", "state", "steps"]);
  });

  it("is 'not started' for a checkpoint with no workflow yet", async () => {
    const t = await setup();
    expect(await t.runner.progress(t.checkpoint.id)).toMatchObject({ state: "not_started", run: 0 });
  });
});

describe("a stalled evaluation", () => {
  it("is reported as stalled once its process is gone, and Resume continues it from the step it stopped at", async () => {
    const t = await setup({ gemini: [new GeminiError("rejected"), goodAnswer()], isLeased: async () => false });
    const real = t.graph.updateState.bind(t.graph);
    t.graph.updateState = vi.fn().mockRejectedValue(new Error("process died"));
    await t.runner.start(t.target);
    t.graph.updateState = real;

    const stalled = await t.runner.progress(t.checkpoint.id);
    expect(stalled.state).toBe("stalled");
    expect(statusOf(stalled)).toMatchObject({ load_context: "done", fetch_diff: "done", generate: "active" });

    expect((await t.runner.resume(t.checkpoint.id)).resumed).toBe(true);
    expect(t.compareCommits).toHaveBeenCalledTimes(1); // the code changes were not fetched again
    expect((await t.runner.progress(t.checkpoint.id)).state).toBe("waiting_faculty");
    expect(t.evaluations.rows).toHaveLength(1);
  });

  it("is not stalled while a process holds the lease", async () => {
    const t = await setup({ gemini: [new GeminiError("rejected")], isLeased: async () => true });
    t.graph.updateState = vi.fn().mockRejectedValue(new Error("process died"));
    await t.runner.start(t.target);
    expect((await t.runner.progress(t.checkpoint.id)).state).toBe("running");
  });
});
