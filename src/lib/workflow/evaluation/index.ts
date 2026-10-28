import "server-only";
import { after } from "next/server";
import { getCheckpointer } from "../checkpointer";
import { getWorkflowPool } from "../db";
import { LeaseHeldError, pgLeaseStore } from "../lease";
import { buildEvaluationGraph, type EvaluationTarget } from "./graph";
import { defaultEvaluationGraphDeps } from "./repository";
import { createEvaluationRunner, type EvaluationRunner } from "./runner";

const KEY = Symbol.for("coLearning.evaluationRunner");
type WithRunner = typeof globalThis & { [KEY]?: EvaluationRunner };

/** One runner per process: the compiled graph, the lease store and the checkpointer, all on the shared pool. */
export function getEvaluationRunner(): EvaluationRunner {
  const holder = globalThis as WithRunner;
  holder[KEY] ??= createEvaluationRunner({
    graph: buildEvaluationGraph(defaultEvaluationGraphDeps(), getCheckpointer()),
    leases: pgLeaseStore(getWorkflowPool()),
  });
  return holder[KEY];
}

/**
 * Starts the week's evaluation workflow after the response has been sent. Nothing here can fail the request:
 * a run that cannot start is logged, and the progress shows where it stopped.
 */
export function startEvaluationInBackground(runner: EvaluationRunner, target: EvaluationTarget): void {
  after(async () => {
    try {
      await runner.start(target);
    } catch (error) {
      if (error instanceof LeaseHeldError) return; // already being run
      console.error("[workflow] background evaluation failed:", error instanceof Error ? error.name : "unknown");
    }
  });
}
