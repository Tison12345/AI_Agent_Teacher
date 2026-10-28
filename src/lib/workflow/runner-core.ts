import { Command } from "@langchain/langgraph";
import { LeaseLostError, NoLeaseError, RunDeadlineError, runWithLease, type LeaseOptions, type LeaseStore } from "./lease";
import type { SnapshotView } from "./progress-core";

/*
 * Runs a workflow graph one thread at a time: claims the thread's lease, starts a new run or continues a paused
 * or stopped one, and turns an error thrown by a node into a recorded failure. Each workflow (submission,
 * evaluation) supplies its thread naming, its fresh-run input, how its errors are described, and its progress.
 */

/** The slice of a compiled graph used here. Parameters are `never` so any compiled graph is accepted. */
export type GraphLike = {
  invoke(input: never, config: never): Promise<unknown>;
  getState(config: never): Promise<{
    values: unknown;
    next: string[];
    tasks: { interrupts: unknown[] }[];
    createdAt?: string;
  }>;
  updateState(config: never, values: never, asNode?: string): Promise<unknown>;
};

export type RunSummary = { outcome: string };

/** A run nobody is running, whose last checkpoint is older than this, is reported as stalled. */
export const STALLED_AFTER_MS = 30_000;

export type FailureRecord = {
  /** The state update recorded as the failed node's result (failure code, reason, trace entry). */
  update: Record<string, unknown>;
  /** Used only when the failure could not be recorded in the graph. */
  lastResort: () => Promise<void>;
};

export type RunnerSpec<Progress> = {
  graph: GraphLike;
  leases: LeaseStore;
  lease?: Partial<LeaseOptions>;
  /** Waits between attempts to wake a run while another run still holds the thread (default: a real timer). */
  sleep?: (ms: number) => Promise<void>;
  threadId(key: string): string;
  /** True while some process holds a live lease on the thread. Without it, a run is never reported as stalled. */
  isLeased?: (threadId: string) => Promise<boolean>;
  /** How old the last checkpoint must be before a run nobody is running counts as stalled. */
  stalledAfterMs?: number;
  /** `arg` is whatever the caller passed to start(); a workflow whose input is just its key ignores it. */
  freshInput(key: string, run: number, arg?: unknown): unknown;
  /** Describes an error thrown by `node` (undefined when unknown) with the graph's values at that moment. */
  describeFailure(key: string, error: unknown, node: string | undefined, values: Record<string, unknown>): FailureRecord;
  /** Receives a SnapshotView typed with this workflow's own node and failure names. */
  project(snapshot: never): Progress;
};

/** The run no longer owns the thread: it must stop without writing anything more. */
const lostOwnership = (error: unknown) => error instanceof LeaseLostError || error instanceof RunDeadlineError || error instanceof NoLeaseError;

export function createRunner<Progress>(spec: RunnerSpec<Progress>) {
  const { graph, leases } = spec;
  const sleep = spec.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const configFor = (key: string, signal?: AbortSignal) =>
    ({ configurable: { thread_id: spec.threadId(key) }, signal, durability: "sync" as const }) as never;
  const lease = (key: string, fn: Parameters<typeof runWithLease<RunSummary>>[1]) =>
    runWithLease(spec.threadId(key), fn, { store: leases, ...spec.lease });
  const outcomeOf = (values: unknown) => ((values as { outcome?: string } | undefined)?.outcome ?? "running");

  /**
   * Work is left (the graph is neither finished nor waiting for a person), nobody holds the lease, and the last
   * checkpoint is older than a few seconds (a run that was only just asked to start has not claimed its lease yet).
   */
  async function isStalled(key: string, snapshot: { values: unknown; next: string[]; createdAt?: string }, interrupted: boolean): Promise<boolean> {
    if (!spec.isLeased || interrupted || snapshot.next.length === 0) return false;
    if (outcomeOf(snapshot.values) !== "running") return false;
    const age = snapshot.createdAt ? Date.now() - new Date(snapshot.createdAt).getTime() : 0;
    if (!(age > (spec.stalledAfterMs ?? STALLED_AFTER_MS))) return false;
    try {
      return !(await spec.isLeased(spec.threadId(key)));
    } catch {
      return false; // cannot tell: do not offer a Resume that might collide with a live run
    }
  }

  /**
   * A node threw. Record the failure in the graph (as that node's result) and let the graph's own failure path
   * finish the run, so the checkpoint and the database tell the same story.
   */
  async function failRun(key: string, error: unknown, signal: AbortSignal): Promise<RunSummary> {
    const config = configFor(key, signal);
    let record: FailureRecord | undefined;
    try {
      const snapshot = await graph.getState(config);
      const node = snapshot.next[0];
      record = spec.describeFailure(key, error, node, (snapshot.values ?? {}) as Record<string, unknown>);
      if (node) {
        await graph.updateState(config, record.update as never, node);
        await graph.invoke(null as never, config);
        return { outcome: "failed" };
      }
    } catch (recordError) {
      if (lostOwnership(recordError)) throw recordError;
      console.error("[workflow] could not record the failure in the graph:", recordError instanceof Error ? recordError.name : "unknown");
    }
    record ??= spec.describeFailure(key, error, undefined, {});
    await record.lastResort().catch(() => console.error("[workflow] could not record the failure"));
    return { outcome: "failed" };
  }

  async function execute(key: string, signal: AbortSignal, input: unknown): Promise<RunSummary> {
    const config = configFor(key, signal);
    try {
      await graph.invoke(input as never, config);
    } catch (error) {
      if (signal.aborted || lostOwnership(error)) throw error;
      return failRun(key, error, signal);
    }
    return { outcome: outcomeOf((await graph.getState(config)).values) };
  }

  async function resume(key: string): Promise<RunSummary & { resumed: boolean }> {
    let resumed = false;
    const summary = await lease(key, async ({ signal }) => {
      const snapshot = await graph.getState(configFor(key, signal));
      if (snapshot.next.length === 0) return { outcome: outcomeOf(snapshot.values) };
      resumed = true;
      const waiting = snapshot.tasks.some((task) => task.interrupts.length > 0);
      return execute(key, signal, waiting ? new Command({ resume: true }) : null);
    });
    return { ...summary, resumed };
  }

  return {
    /**
     * Starts a new run: the first one, or a retry after a failure. It runs to the end, or until the graph waits
     * for faculty. Throws LeaseHeldError when the thread is already being run.
     */
    start(key: string, arg?: unknown): Promise<RunSummary> {
      return lease(key, async ({ signal }) => {
        const previous = await graph.getState(configFor(key, signal));
        const run = ((previous.values as { run?: number } | undefined)?.run ?? 0) + 1;
        return execute(key, signal, spec.freshInput(key, run, arg));
      });
    },

    /**
     * Continues a thread: wakes it after faculty decided, or continues one that stopped part-way (a crashed or
     * stopped process). Does nothing when the graph is not waiting for anything.
     */
    resume,

    /**
     * After a faculty decision: wakes the paused graph. The decision is already final in the database, so this
     * is best-effort. While another run still holds the thread (it is about to pause), it tries again.
     */
    async resumeAfterDecision(key: string): Promise<void> {
      for (let attempt = 1; attempt <= 4; attempt++) {
        try {
          await resume(key);
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
    async progress(key: string): Promise<Progress> {
      const snapshot = await graph.getState(configFor(key));
      const interrupted = snapshot.tasks.some((task) => task.interrupts.length > 0);
      const view: SnapshotView = {
        values: (snapshot.values ?? {}) as SnapshotView["values"],
        next: snapshot.next,
        interrupted,
        stalled: await isStalled(key, snapshot, interrupted),
      };
      return spec.project(view as never);
    },
  };
}
