import "server-only";
import { after } from "next/server";
import { getCheckpointer } from "../checkpointer";
import { getWorkflowPool, WorkflowConfigError } from "../db";
import { LeaseHeldError, pgLeaseStore } from "../lease";
import { buildSubmissionGraph } from "./graph";
import { defaultSubmissionGraphDeps, supabaseWorkflowStore } from "./repository";
import { createSubmissionRunner, type SubmissionRunner } from "./runner";

const KEY = Symbol.for("coLearning.submissionRunner");
type WithRunner = typeof globalThis & { [KEY]?: SubmissionRunner };

/** One runner per process: the compiled graph, the lease store and the checkpointer, all on the shared pool. */
export function getSubmissionRunner(): SubmissionRunner {
  const holder = globalThis as WithRunner;
  holder[KEY] ??= createSubmissionRunner({
    graph: buildSubmissionGraph(defaultSubmissionGraphDeps(), getCheckpointer()),
    leases: pgLeaseStore(getWorkflowPool()),
    store: supabaseWorkflowStore,
  });
  return holder[KEY];
}

const NOT_SET_UP = "Marking is not set up on the server. Please try again later.";

/**
 * Starts the submission's workflow after the response has been sent, so the student's upload does not wait for
 * it. Nothing here can fail the request: problems are logged, and the submission keeps its own status.
 */
export function startInBackground(submissionId: string): void {
  after(async () => {
    try {
      await getSubmissionRunner().start(submissionId);
    } catch (error) {
      if (error instanceof LeaseHeldError) return; // already being run
      console.error("[workflow] background run failed:", error instanceof Error ? error.name : "unknown");
      // Without a working workflow database the submission would stay "processing" forever: say so instead.
      if (error instanceof WorkflowConfigError) await supabaseWorkflowStore.setFailed(submissionId, NOT_SET_UP).catch(() => {});
    }
  });
}
