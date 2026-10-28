import { Command, NodeTimeoutError } from "@langchain/langgraph";
import { GeminiError } from "@/lib/gemini/errors";
import { ExtractorError } from "@/lib/submissions/extractor";
import { LeaseLostError, NoLeaseError, RunDeadlineError, runWithLease, type LeaseOptions, type LeaseStore } from "../lease";
import { freshRunInput, ReadFileError, type SubmissionGraph, type SubmissionStateValues, type WorkflowStore } from "./graph";
import { projectProgress, WORKFLOW_NODES, type FailureCode, type WorkflowNode, type WorkflowProgress } from "./progress";

export const submissionThread = (submissionId: string) => `submission:${submissionId}`;

const GENERIC_MARKING = "Marking could not be completed. Please try again.";
const GENERIC_READING = "Something went wrong while reading your file. Please try again.";

type Classified = { code: FailureCode; reason: string };

/** Turns an error into the failure code and the sentence stored on the submission. Raw details are only logged. */
export function classifyFailure(error: unknown, node: WorkflowNode | undefined): Classified {
  if (error instanceof ExtractorError || error instanceof ReadFileError) return { code: "read_failed", reason: error.userMessage };
  if (error instanceof GeminiError) return { code: "marking_unavailable", reason: `Marking could not be completed. ${error.message}` };
  if (error instanceof NodeTimeoutError) {
    return { code: "marking_unavailable", reason: `Marking could not be completed. ${new GeminiError("timeout").message}` };
  }
  console.error("[workflow] unexpected error in", node ?? "unknown node", ":", error instanceof Error ? error.name : "unknown");
  if (node === "save_result") return { code: "save_failed", reason: GENERIC_MARKING };
  return { code: "unexpected", reason: node === "extract_text" ? GENERIC_READING : GENERIC_MARKING };
}

/** The run no longer owns the thread: it must stop without writing anything more. */
const lostOwnership = (error: unknown) => error instanceof LeaseLostError || error instanceof RunDeadlineError || error instanceof NoLeaseError;

export type RunnerOptions = {
  graph: SubmissionGraph;
  leases: LeaseStore;
  /** Used only when the failure itself could not be recorded in the graph. */
  store: WorkflowStore;
  lease?: Partial<LeaseOptions>;
  /** Waits between attempts to resume while another run still holds the thread (default: a real timer). */
  sleep?: (ms: number) => Promise<void>;
};

export type RunSummary = { outcome: SubmissionStateValues["outcome"] };

export function createSubmissionRunner(options: RunnerOptions) {
  const { graph, leases, store } = options;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const configFor = (id: string, signal?: AbortSignal) => ({ configurable: { thread_id: submissionThread(id) }, signal, durability: "sync" as const });
  const lease = (id: string, fn: Parameters<typeof runWithLease<RunSummary>>[1]) =>
    runWithLease(submissionThread(id), fn, { store: leases, ...options.lease });

  /**
   * A node threw. Record the failure in the graph (as that node's result) and let the graph's own failure path
   * (park_failed) mark the submission, so the checkpoint and the database tell the same story.
   */
  async function failRun(id: string, error: unknown, signal: AbortSignal): Promise<RunSummary> {
    const config = configFor(id, signal);
    let node: WorkflowNode | undefined;
    let failure: Classified | undefined;
    try {
      const snapshot = await graph.getState(config);
      const pending = snapshot.next[0];
      node = WORKFLOW_NODES.find((name) => name === pending);
      failure = classifyFailure(error, node);
      if (node) {
        const values = snapshot.values as SubmissionStateValues;
        const attempt = node === "grade" ? values.gradeAttempt + 1 : node === "check_grade" ? values.gradeAttempt : 1;
        await graph.updateState(
          config,
          { failureCode: failure.code, failureReason: failure.reason, trace: [{ run: values.run, node, attempt, result: "failed" }] },
          node,
        );
        await graph.invoke(null, config);
        return { outcome: "failed" };
      }
    } catch (recordError) {
      if (lostOwnership(recordError)) throw recordError;
      console.error("[workflow] could not record the failure in the graph:", recordError instanceof Error ? recordError.name : "unknown");
    }
    // Last resort: the submission must not stay "processing" forever.
    failure ??= classifyFailure(error, node);
    await store.setFailed(id, failure.reason).catch(() => console.error("[workflow] could not mark the submission failed"));
    return { outcome: "failed" };
  }

  async function execute(id: string, signal: AbortSignal, input: Parameters<SubmissionGraph["invoke"]>[0]): Promise<RunSummary> {
    const config = configFor(id, signal);
    try {
      await graph.invoke(input, config);
    } catch (error) {
      if (signal.aborted || lostOwnership(error)) throw error;
      return failRun(id, error, signal);
    }
    const after = await graph.getState(config);
    return { outcome: (after.values as SubmissionStateValues).outcome };
  }

  async function resume(id: string): Promise<RunSummary & { resumed: boolean }> {
    let resumed = false;
    const summary = await lease(id, async ({ signal }) => {
      const snapshot = await graph.getState(configFor(id, signal));
      const values = snapshot.values as Partial<SubmissionStateValues> | undefined;
      if (snapshot.next.length === 0) return { outcome: values?.outcome ?? "running" };
      resumed = true;
      const waiting = snapshot.tasks.some((task) => task.interrupts.length > 0);
      return execute(id, signal, waiting ? new Command({ resume: true }) as never : null);
    });
    return { ...summary, resumed };
  }

  return {
    /**
     * Starts a new run: the first one for a submission, or a retry after a failure. It runs to the end, or until
     * the graph waits for faculty. Throws LeaseHeldError when the thread is already being run.
     */
    start(id: string): Promise<RunSummary> {
      return lease(id, async ({ signal }) => {
        const previous = await graph.getState(configFor(id, signal));
        const run = ((previous.values as Partial<SubmissionStateValues> | undefined)?.run ?? 0) + 1;
        return execute(id, signal, freshRunInput(id, run));
      });
    },

    /**
     * Continues a thread: wakes it after faculty decided, or continues one that stopped part-way (a crashed or
     * stopped process). Does nothing when the graph is not waiting for anything.
     */
    resume,

    /**
     * After a faculty decision: wakes the paused graph. The decision is already final in the database, so
     * this is best-effort. While another run still holds the thread (it is about to pause), it tries again.
     */
    async resumeAfterDecision(id: string): Promise<void> {
      for (let attempt = 1; attempt <= 4; attempt++) {
        try {
          await resume(id);
          return;
        } catch (error) {
          if ((error as Error).name !== "LeaseHeldError" || attempt === 4) {
            console.error("[workflow] could not wake the paused run:", error instanceof Error ? error.name : "unknown");
            return;
          }
          await sleep(1_500);
        }
      }
    },

    /** The allowlisted progress, read from the checkpoint. Needs no lease: reading changes nothing. */
    async progress(id: string): Promise<WorkflowProgress> {
      const snapshot = await graph.getState(configFor(id));
      return projectProgress({
        values: snapshot.values ?? {},
        next: snapshot.next,
        interrupted: snapshot.tasks.some((task) => task.interrupts.length > 0),
      });
    },
  };
}

export type SubmissionRunner = ReturnType<typeof createSubmissionRunner>;
