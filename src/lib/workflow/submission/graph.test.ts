// @vitest-environment node
import { MemorySaver } from "@langchain/langgraph";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GeminiError } from "@/lib/gemini/errors";
import type { AiResult } from "@/lib/schemas/submission";
import { ExtractorError, type Extraction } from "@/lib/submissions/extractor";
import { ANSWER, bad, fakeDeps, good, ID, reply, scanned, typed, type Behaviour } from "@/test/submission-workflow";
import { LeaseLostError, type LeaseStore } from "../lease";
import { buildSubmissionGraph } from "./graph";
import { createSubmissionRunner, submissionThread } from "./runner";

type Setup = Behaviour & {
  lease?: Partial<LeaseStore>;
  leaseOptions?: Parameters<typeof createSubmissionRunner>[0]["lease"];
  isLeased?: (threadId: string) => Promise<boolean>;
};

function setup(options: Setup = {}) {
  const { db, store, deps, extract, requestGrading } = fakeDeps(options);
  const leases: LeaseStore = { claim: async () => true, renew: async () => true, release: async () => true, ...options.lease };
  const graph = buildSubmissionGraph(deps, new MemorySaver());
  const runner = createSubmissionRunner({
    graph,
    leases,
    store,
    sleep: async () => {},
    isLeased: options.isLeased,
    stalledAfterMs: 0,
    lease: { heartbeatMs: 10_000, selfAbortMs: 20_000, runDeadlineMs: 60_000, ...options.leaseOptions },
  });
  return { db, deps, extract, requestGrading, runner, graph };
}

const statusOf = (progress: Awaited<ReturnType<ReturnType<typeof setup>["runner"]["progress"]>>) =>
  Object.fromEntries(progress.steps.map((step) => [step.id, step.status]));

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("assignment workflow: the normal path", () => {
  it("reads, marks, validates and saves the recommendation, then pauses for faculty", async () => {
    const t = setup();
    const summary = await t.runner.start(ID);
    expect(summary.outcome).toBe("running"); // paused, not finished
    expect(t.db).toMatchObject({ status: "awaiting_review", text: ANSWER, textSaves: 1, saves: 1 });
    expect(t.db.aiResult?.feedback).toBe("Well done.");

    const progress = await t.runner.progress(ID);
    expect(progress.state).toBe("waiting_faculty");
    expect(statusOf(progress)).toEqual({
      extract_text: "done",
      check_readable: "done",
      grade: "done",
      check_grade: "done",
      save_result: "done",
      await_faculty: "waiting",
      finish: "pending",
    });
  });

  it("finishes after faculty decide: the decision is read from the database, never taken from the wake-up", async () => {
    const t = setup();
    await t.runner.start(ID);
    t.db.decided = true; // decide_submission ran
    const woken = await t.runner.resume(ID);
    expect(woken).toMatchObject({ resumed: true, outcome: "complete" });
    const progress = await t.runner.progress(ID);
    expect(progress.state).toBe("complete");
    expect(progress.steps.every((step) => step.status === "done")).toBe(true);
  });

  it("a wake-up without a decision does not finish the run: it keeps waiting", async () => {
    const t = setup();
    await t.runner.start(ID);
    await t.runner.resume(ID);
    expect((await t.runner.progress(ID)).state).toBe("waiting_faculty");
    t.db.decided = true;
    expect((await t.runner.resume(ID)).outcome).toBe("complete");
  });

  it("a decision made before the graph reaches the review step does not make it wait", async () => {
    const t = setup();
    t.db.decided = true;
    // The submission is awaiting review in the database by the time the graph gets to await_faculty.
    const summary = await t.runner.start(ID);
    expect(summary.outcome).toBe("complete");
  });

  it("waking a thread that is not waiting does nothing", async () => {
    const t = setup();
    expect(await t.runner.resume(ID)).toMatchObject({ resumed: false });
    await t.runner.start(ID);
    t.db.decided = true;
    await t.runner.resume(ID);
    expect(await t.runner.resume(ID)).toMatchObject({ resumed: false, outcome: "complete" });
  });
});

describe("assignment workflow: routing", () => {
  it("a scanned document goes to needs_ocr and is never marked", async () => {
    const t = setup({ extract: async () => scanned });
    expect((await t.runner.start(ID)).outcome).toBe("needs_ocr");
    expect(t.requestGrading).not.toHaveBeenCalled();
    expect(t.db).toMatchObject({ status: "needs_ocr" });
    expect(t.db.error).toMatch(/scanned or image-only PDF/);
    const progress = await t.runner.progress(ID);
    expect(progress.state).toBe("needs_ocr");
    expect(statusOf(progress)).toMatchObject({ extract_text: "done", check_readable: "done", grade: "skipped", await_faculty: "skipped" });
  });

  it("a submission that is no longer processing is left alone", async () => {
    const t = setup({ init: { status: "awaiting_review", text: ANSWER, extraction: { pages: typed.pages, warnings: [] } } });
    expect((await t.runner.start(ID)).outcome).toBe("skipped");
    expect(t.extract).not.toHaveBeenCalled();
    expect(t.requestGrading).not.toHaveBeenCalled();
  });

  it("an answer that fails the checks gets one corrected attempt, told what was wrong", async () => {
    const t = setup({ grading: [reply(bad), reply(good)] });
    await t.runner.start(ID);
    expect(t.requestGrading).toHaveBeenCalledTimes(2);
    expect(t.requestGrading.mock.calls[0][1]).toBeUndefined();
    expect(t.requestGrading.mock.calls[1][1]).toMatch(/quote/i);
    expect(t.db.status).toBe("awaiting_review");
    const progress = await t.runner.progress(ID);
    expect(progress.steps.find((step) => step.id === "grade")).toMatchObject({ status: "done", attempt: 2 });
  });

  it("two bad answers in a row fail the submission with a reason and a retry, never a guessed result", async () => {
    const t = setup({ grading: [reply(bad)] });
    expect((await t.runner.start(ID)).outcome).toBe("failed");
    expect(t.requestGrading).toHaveBeenCalledTimes(2);
    expect(t.db).toMatchObject({ status: "failed", aiResult: null });
    expect(t.db.error).toBe(`Marking could not be completed. ${new GeminiError("invalid_response").message}`);
    const progress = await t.runner.progress(ID);
    expect(progress.failure).toEqual({ code: "marking_invalid", message: "The AI marking could not be completed." });
    expect(statusOf(progress).check_grade).toBe("failed");
  });
});

describe("assignment workflow: failures and the one transient retry", () => {
  it("a timeout is tried once more, and the second try can succeed", async () => {
    const t = setup({ grading: [new GeminiError("timeout"), reply(good)] });
    await t.runner.start(ID);
    expect(t.requestGrading).toHaveBeenCalledTimes(2);
    expect(t.db.status).toBe("awaiting_review");
  });

  it("a 503 is tried once more but not forever", async () => {
    const t = setup({ grading: [new GeminiError("unavailable")] });
    expect((await t.runner.start(ID)).outcome).toBe("failed");
    expect(t.requestGrading).toHaveBeenCalledTimes(2);
    expect(t.db.error).toContain("temporarily unavailable");
    expect((await t.runner.progress(ID)).failure?.code).toBe("marking_unavailable");
  });

  it.each(["rate_limited", "quota_exhausted", "rejected", "not_configured"] as const)("%s is never tried again", async (code) => {
    const t = setup({ grading: [new GeminiError(code)] });
    expect((await t.runner.start(ID)).outcome).toBe("failed");
    expect(t.requestGrading).toHaveBeenCalledTimes(1);
    expect(t.db.status).toBe("failed");
  });

  it("when the reading service is down the submission is failed in the service's own words", async () => {
    const message = "The text-reading service is not running. Please try again in a moment.";
    const t = setup({ extract: async () => Promise.reject(new ExtractorError("unavailable", message)) });
    expect((await t.runner.start(ID)).outcome).toBe("failed");
    expect(t.db).toMatchObject({ status: "failed", error: message, text: null });
    expect(t.requestGrading).not.toHaveBeenCalled();
    expect((await t.runner.progress(ID)).failure?.code).toBe("read_failed");
  });

  it("an unexpected error never leaks its details to the student or to the progress", async () => {
    const t = setup();
    t.db.saveBehaviour = "db-down";
    expect((await t.runner.start(ID)).outcome).toBe("failed");
    expect(t.db.error).toBe("Marking could not be completed. Please try again.");
    const shown = JSON.stringify(await t.runner.progress(ID)) + t.db.error;
    expect(shown).not.toMatch(/hunter2|ECONNREFUSED|secret-host/);
    expect((await t.runner.progress(ID)).failure?.code).toBe("save_failed");
  });

  it("a failed submission can be tried again: a new run starts from the stored text and shows only itself", async () => {
    const t = setup({ grading: [new GeminiError("rejected"), reply(good)] });
    await t.runner.start(ID);
    expect(t.db.status).toBe("failed");
    t.db.status = "processing"; // the retry route's atomic claim
    t.db.error = null;
    await t.runner.start(ID);
    expect(t.extract).toHaveBeenCalledTimes(1); // the saved text was reused, not read again
    expect(t.db.status).toBe("awaiting_review");
    const progress = await t.runner.progress(ID);
    expect(progress.state).toBe("waiting_faculty");
    expect(progress.failure).toBeNull();
    expect(statusOf(progress).grade).toBe("done");
  });
});

describe("assignment workflow: a repeated node does no harm", () => {
  it("text that is already saved is reused, never read or saved a second time", async () => {
    const t = setup({ init: { text: ANSWER, extraction: { pages: typed.pages, warnings: [] } } });
    await t.runner.start(ID);
    expect(t.extract).not.toHaveBeenCalled();
    expect(t.db.textSaves).toBe(0);
    expect(t.db.status).toBe("awaiting_review");
  });

  it("a recommendation saved by an earlier, interrupted attempt of the step is accepted, not treated as an error", async () => {
    const t = setup();
    t.db.aiResult = { questions: [], feedback: "from the earlier attempt", notes: [] } as unknown as AiResult;
    t.db.status = "processing";
    await t.runner.start(ID);
    expect((await t.runner.progress(ID)).state).toBe("waiting_faculty");
    expect(t.db.aiResult?.feedback).toBe("from the earlier attempt");
  });

  it("if the submission moved on before the result could be saved, the run ends quietly", async () => {
    const t = setup();
    t.db.saveBehaviour = "moved-on";
    expect((await t.runner.start(ID)).outcome).toBe("skipped");
  });

  it("a process that dies mid-run is continued from the node it stopped at, not from the start", async () => {
    const t = setup({ grading: [new GeminiError("rejected")] });
    // Simulate a crash: the first process cannot record the failure (its writes are refused), then it is gone.
    const real = t.graph.updateState.bind(t.graph);
    t.graph.updateState = vi.fn().mockRejectedValue(new Error("process died"));
    await t.runner.start(ID);
    t.graph.updateState = real;
    t.db.status = "processing";
    t.db.error = null;
    // The checkpoint is still at "grade" (it never completed); a new process continues it.
    const progress = await t.runner.progress(ID);
    expect(statusOf(progress)).toMatchObject({ extract_text: "done", check_readable: "done", grade: "active" });
    t.requestGrading.mockResolvedValue(reply(good));
    await t.runner.resume(ID);
    expect(t.extract).toHaveBeenCalledTimes(1);
    expect(t.db.status).toBe("awaiting_review");
  });
});

describe("assignment workflow: leases", () => {
  it("only one process runs a submission: a second start is refused", async () => {
    const t = setup({ lease: { claim: async () => false } });
    await expect(t.runner.start(ID)).rejects.toMatchObject({ name: "LeaseHeldError" });
    expect(t.extract).not.toHaveBeenCalled();
  });

  it("a run that loses its lease stops without failing the submission or writing anything more", async () => {
    let calls = 0;
    const t = setup({
      lease: { renew: async () => false },
      leaseOptions: { heartbeatMs: 5, selfAbortMs: 20_000, runDeadlineMs: 60_000, freshMs: 0 },
      extract: () => {
        calls += 1;
        return new Promise<Extraction>((_resolve, reject) => setTimeout(() => reject(new Error("too late")), 200));
      },
    });
    await expect(t.runner.start(ID)).rejects.toBeInstanceOf(LeaseLostError);
    expect(calls).toBe(1);
    expect(t.db.status).toBe("processing"); // the new owner decides what happens next
    expect(t.requestGrading).not.toHaveBeenCalled();
  });

  it("uses one thread per submission", () => {
    expect(submissionThread(ID)).toBe(`submission:${ID}`);
  });
});

describe("what the progress shows", () => {
  it("contains only step names and statuses, never the text, the AI's output, scores or feedback", async () => {
    const t = setup();
    await t.runner.start(ID);
    const json = JSON.stringify(await t.runner.progress(ID));
    for (const secret of ["loop repeats", "ordered collection", "Well done", "Defines repetition", "quotes", "explanation", "marks", "rubric"]) {
      expect(json).not.toContain(secret);
    }
    expect(Object.keys(JSON.parse(json)).sort()).toEqual(["failure", "state", "steps"]);
  });

  it("is 'not started' for a submission that has no workflow yet", async () => {
    const t = setup();
    const progress = await t.runner.progress(ID);
    expect(progress.state).toBe("not_started");
    expect(progress.steps.every((step) => step.status === "pending")).toBe(true);
  });
});

describe("a stalled run", () => {
  /** A run whose process died after the marking step: the checkpoint stops at grade and nothing can be recorded. */
  async function stalledAt(over: Setup = {}) {
    const t = setup({ grading: [new GeminiError("rejected")], ...over });
    const real = t.graph.updateState.bind(t.graph);
    t.graph.updateState = vi.fn().mockRejectedValue(new Error("process died"));
    await t.runner.start(ID);
    t.graph.updateState = real;
    t.db.status = "processing";
    t.db.error = null;
    t.requestGrading.mockResolvedValue(reply(good));
    return t;
  }

  it("is reported as stalled when work is left and nobody holds the lease, and the progress still shows the step", async () => {
    const t = await stalledAt({ isLeased: async () => false });
    const progress = await t.runner.progress(ID);
    expect(progress.state).toBe("stalled");
    expect(statusOf(progress)).toMatchObject({ extract_text: "done", check_readable: "done", grade: "active" });
  });

  it("is not stalled while a process holds the lease, or when the lease cannot be checked", async () => {
    expect((await (await stalledAt({ isLeased: async () => true })).runner.progress(ID)).state).toBe("running");
    expect((await (await stalledAt({ isLeased: async () => { throw new Error("db down"); } })).runner.progress(ID)).state).toBe("running");
    expect((await (await stalledAt()).runner.progress(ID)).state).toBe("running"); // no lease check configured
  });

  it("a run that was only just asked to start is not called stalled yet", async () => {
    const t = await stalledAt({ isLeased: async () => false });
    const young = createSubmissionRunner({ graph: t.graph, leases: { claim: async () => true, renew: async () => true, release: async () => true }, store: t.deps.store, isLeased: async () => false, stalledAfterMs: 60_000 });
    expect((await young.progress(ID)).state).toBe("running");
  });

  it("a paused or finished run is never stalled", async () => {
    const paused = setup({ isLeased: async () => false });
    await paused.runner.start(ID);
    expect((await paused.runner.progress(ID)).state).toBe("waiting_faculty");
    paused.db.decided = true;
    await paused.runner.resume(ID);
    expect((await paused.runner.progress(ID)).state).toBe("complete");
  });

  it("Resume continues from the step it stopped at and the run finishes its course", async () => {
    const t = await stalledAt({ isLeased: async () => false });
    expect((await t.runner.resume(ID)).resumed).toBe(true);
    expect(t.extract).toHaveBeenCalledTimes(1); // the reading was not repeated
    expect((await t.runner.progress(ID)).state).toBe("waiting_faculty");
    expect(t.db.status).toBe("awaiting_review");
  });
});
