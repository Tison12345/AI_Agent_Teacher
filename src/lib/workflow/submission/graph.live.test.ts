// @vitest-environment node
// Live test of the assignment workflow against the real Supabase Postgres, as the restricted `langgraph_app`
// role: the real checkpointer and run leases, with a memory submission database and a fake Gemini. It proves the
// graph's state (reducers, nested results, interrupts) round-trips through the real checkpoint tables, that a
// restarted process continues a paused run, and that the progress read from the checkpoint is student-safe.
// Skipped when DATABASE_URL is not set. Prints no credentials. Run with `npm run test:live`.
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GeminiError } from "@/lib/gemini/errors";
import { fakeDeps, good, reply } from "@/test/submission-workflow";
import { FencedPostgresSaver } from "../checkpointer";
import { createWorkflowPool } from "../db";
import { pgLeaseStore, runWithLease } from "../lease";
import { buildSubmissionGraph } from "./graph";
import { createSubmissionRunner, submissionThread } from "./runner";

const configured = Boolean(process.env.DATABASE_URL);
const ids: string[] = [];
const newId = () => {
  const id = crypto.randomUUID();
  ids.push(id);
  return id;
};

let pool: Pool;
const lease = { heartbeatMs: 1_000, selfAbortMs: 8_000, runDeadlineMs: 90_000 };

/** A runner on the real checkpointer and leases. A new runner on the same pool is a "restarted process". */
function runnerFor(options: Parameters<typeof fakeDeps>[0] = {}) {
  const fake = fakeDeps(options);
  const graph = buildSubmissionGraph(fake.deps, new FencedPostgresSaver(pool));
  const runner = createSubmissionRunner({ graph, leases: pgLeaseStore(pool), store: fake.store, lease });
  return { ...fake, runner };
}

describe.skipIf(!configured)("assignment workflow (live Postgres, restricted role)", { timeout: 120_000 }, () => {
  beforeAll(() => {
    pool = createWorkflowPool({ max: 3 });
  });

  afterAll(async () => {
    const saver = new FencedPostgresSaver(pool);
    await Promise.all(
      ids.map((id) => {
        const thread = submissionThread(id);
        return runWithLease(thread, () => saver.deleteThread(thread), { store: pgLeaseStore(pool), ...lease }).catch(() => {});
      }),
    );
    await pool.end().catch(() => {});
  }, 120_000);

  it("pauses for faculty, survives a restart, and finishes after the decision", async () => {
    const id = newId();
    const first = runnerFor();
    await first.runner.start(id);
    expect((await first.runner.progress(id)).state).toBe("waiting_faculty");
    expect(first.db.status).toBe("awaiting_review");

    // A new process: new graph objects, same database. It must see the paused run in the checkpoint tables.
    const second = runnerFor();
    second.db.decided = true;
    const progress = await second.runner.progress(id);
    expect(progress.state).toBe("waiting_faculty");
    expect(progress.steps.find((step) => step.id === "await_faculty")?.status).toBe("waiting");
    expect(await second.runner.resume(id)).toMatchObject({ resumed: true, outcome: "complete" });
    expect((await second.runner.progress(id)).state).toBe("complete");
    expect(second.extract).not.toHaveBeenCalled(); // nothing before the pause ran again
    expect(second.requestGrading).not.toHaveBeenCalled();
  });

  it("records a failure through the graph, and the stored progress shows only the fixed sentence", async () => {
    const id = newId();
    const t = runnerFor({ grading: [new GeminiError("rejected")] });
    expect((await t.runner.start(id)).outcome).toBe("failed");
    const progress = await t.runner.progress(id);
    expect(progress.failure).toEqual({ code: "marking_unavailable", message: "The AI marking service could not be reached." });
    expect(JSON.stringify(progress)).not.toMatch(/Gemini rejected|API key/);
  });

  it("a corrected attempt is kept across the checkpoint tables and a retry run starts fresh", async () => {
    const id = newId();
    const bad = JSON.parse(reply(good));
    bad.questions[0].quotes = ["never written by the student"];
    const t = runnerFor({ grading: [reply(bad), reply(good)] });
    await t.runner.start(id);
    const progress = await t.runner.progress(id);
    expect(progress.steps.find((step) => step.id === "grade")).toMatchObject({ status: "done", attempt: 2 });
  });

  it("two processes cannot run the same submission at once", async () => {
    const id = newId();
    const slow = runnerFor({ extract: () => new Promise((resolve) => setTimeout(() => resolve({ text: "x".repeat(500), pages: [{ number: 1, chars: 500 }], warnings: [] }), 3_000)) });
    const other = runnerFor();
    const running = slow.runner.start(id);
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    await expect(other.runner.start(id)).rejects.toMatchObject({ name: "LeaseHeldError" });
    await running;
  });
});
