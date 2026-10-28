// @vitest-environment node
// Live test of the weekly evaluation workflow against the real Supabase Postgres, as the restricted
// `langgraph_app` role: the real checkpointer and run leases, with memory stores for the project data and
// scripted GitHub and Gemini. It proves the graph's state (the GitHub diff, the checked review, reducers,
// interrupts) round-trips through the real checkpoint tables, that a restarted process continues a paused run,
// and that the progress read back is student-safe. Skipped when DATABASE_URL is not set.
// Prints no credentials. Run with `npm run test:live`.
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GeminiError } from "@/lib/gemini/errors";
import { STRONG } from "@/lib/evaluation/fixtures";
import { badAnswer, evaluationHarness, goodAnswer, toDiff } from "@/test/evaluation-workflow";
import { FencedPostgresSaver } from "../checkpointer";
import { createWorkflowPool } from "../db";
import { pgLeaseStore, runWithLease } from "../lease";
import { buildEvaluationGraph } from "./graph";
import { createEvaluationRunner, evaluationThread } from "./runner";

const configured = Boolean(process.env.DATABASE_URL);
const lease = { heartbeatMs: 1_000, selfAbortMs: 8_000, runDeadlineMs: 90_000 };
const checkpointIds: string[] = [];
let pool: Pool;

/** A runner on the real checkpointer and leases. A new runner on the same pool is a "restarted process". */
async function start(options: Parameters<typeof evaluationHarness>[0] = {}) {
  const h = evaluationHarness(options);
  const recorded = await h.record(1);
  // The memory store numbers its checkpoints the same way every time, so each run gets its own thread.
  const checkpointId = crypto.randomUUID();
  checkpointIds.push(checkpointId);
  const target = { ...h.target(recorded), checkpointId };
  const runner = createEvaluationRunner({ graph: buildEvaluationGraph(h.deps, new FencedPostgresSaver(pool)), leases: pgLeaseStore(pool), lease });
  return { h, runner, target, key: checkpointId };
}

describe.skipIf(!configured)("evaluation workflow (live Postgres, restricted role)", { timeout: 120_000 }, () => {
  beforeAll(() => {
    pool = createWorkflowPool({ max: 3 });
  });

  afterAll(async () => {
    const saver = new FencedPostgresSaver(pool);
    await Promise.all(
      checkpointIds.map((id) => {
        const thread = evaluationThread(id);
        return runWithLease(thread, () => saver.deleteThread(thread), { store: pgLeaseStore(pool), ...lease }).catch(() => {});
      }),
    );
    await pool.end().catch(() => {});
  }, 120_000);

  it("pauses for the teacher, survives a restart, and finishes after the decision", async () => {
    const first = await start();
    await first.runner.start(first.target);
    expect((await first.runner.progress(first.key)).state).toBe("waiting_faculty");
    expect(first.h.evaluations.rows).toHaveLength(1);

    // A new process: new graph objects, same database. It must see the paused run in the checkpoint tables.
    const again = createEvaluationRunner({ graph: buildEvaluationGraph(first.h.deps, new FencedPostgresSaver(pool)), leases: pgLeaseStore(pool), lease });
    const progress = await again.progress(first.key);
    expect(progress).toMatchObject({ state: "waiting_faculty", run: 1, failure: null });
    expect(progress.steps.find((step) => step.id === "await_faculty")?.status).toBe("waiting");

    first.h.decide(1);
    expect(await again.resume(first.key)).toMatchObject({ resumed: true, outcome: "complete" });
    expect((await again.progress(first.key)).state).toBe("complete");
    expect(first.h.compareCommits).toHaveBeenCalledTimes(1); // nothing before the pause ran again
    expect(first.h.requestEvaluation).toHaveBeenCalledTimes(1);
  });

  it("keeps the diff and the checked review in the checkpoint but shows the student neither", async () => {
    const t = await start();
    await t.runner.start(t.target);
    const text = JSON.stringify(await t.runner.progress(t.key));
    for (const secret of ["94", "suggested", "rationale", "evidence", "function", "patch", "confidence"]) expect(text).not.toContain(secret);
  });

  it("records a failure through the graph, and a retry is a new run on the same thread", async () => {
    const t = await start({ gemini: [new GeminiError("rate_limited"), goodAnswer()] });
    expect((await t.runner.start(t.target)).outcome).toBe("failed");
    expect(await t.runner.progress(t.key)).toMatchObject({ state: "failed", run: 1, failure: { code: "ai_rate_limited" } });
    await t.runner.start(t.target);
    expect(await t.runner.progress(t.key)).toMatchObject({ state: "waiting_faculty", run: 2, failure: null });
  });

  it("a corrected attempt is kept across the checkpoint tables", async () => {
    const t = await start({ gemini: [badAnswer(), goodAnswer()] });
    await t.runner.start(t.target);
    const progress = await t.runner.progress(t.key);
    expect(progress.steps.find((step) => step.id === "generate")).toMatchObject({ status: "done", attempt: 2 });
  });

  it("two processes cannot run the same checkpoint at once", async () => {
    const slow = await start();
    slow.h.compareCommits.mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve(toDiff(STRONG)), 3_000)));
    const other = createEvaluationRunner({ graph: buildEvaluationGraph(slow.h.deps, new FencedPostgresSaver(pool)), leases: pgLeaseStore(pool), lease });
    const running = slow.runner.start(slow.target);
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    await expect(other.start(slow.target)).rejects.toMatchObject({ name: "LeaseHeldError" });
    await running;
  });
});
