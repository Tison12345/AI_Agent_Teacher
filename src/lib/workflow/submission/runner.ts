import { NodeTimeoutError } from "@langchain/langgraph";
import { GeminiError } from "@/lib/gemini/errors";
import { ExtractorError } from "@/lib/submissions/extractor";
import type { LeaseOptions, LeaseStore } from "../lease";
import { createRunner } from "../runner-core";
import { freshRunInput, ReadFileError, type SubmissionGraph, type SubmissionStateValues, type WorkflowStore } from "./graph";
import { projectProgress, WORKFLOW_NODES, type FailureCode, type WorkflowNode } from "./progress";

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

export type RunnerOptions = {
  graph: SubmissionGraph;
  leases: LeaseStore;
  /** Used only when the failure itself could not be recorded in the graph. */
  store: WorkflowStore;
  lease?: Partial<LeaseOptions>;
  sleep?: (ms: number) => Promise<void>;
  /** See RunnerSpec.isLeased: lets progress() report a run nobody is running as stalled. */
  isLeased?: (threadId: string) => Promise<boolean>;
  stalledAfterMs?: number;
};

export type RunSummary = { outcome: SubmissionStateValues["outcome"] };

export function createSubmissionRunner(options: RunnerOptions) {
  const core = createRunner({
    graph: options.graph,
    leases: options.leases,
    lease: options.lease,
    sleep: options.sleep,
    isLeased: options.isLeased,
    stalledAfterMs: options.stalledAfterMs,
    threadId: submissionThread,
    freshInput: freshRunInput,
    project: projectProgress,
    describeFailure(id, error, pending, values) {
      const node = WORKFLOW_NODES.find((name) => name === pending);
      const failure = classifyFailure(error, node);
      const state = values as Partial<SubmissionStateValues>;
      const attempt = node === "grade" ? (state.gradeAttempt ?? 0) + 1 : node === "check_grade" ? (state.gradeAttempt ?? 0) : 1;
      return {
        update: {
          failureCode: failure.code,
          failureReason: failure.reason,
          trace: node ? [{ run: state.run ?? 1, node, attempt, result: "failed" }] : [],
        },
        // The submission must not stay "processing" forever.
        lastResort: () => options.store.setFailed(id, failure.reason),
      };
    },
  });
  return core as Omit<typeof core, "start"> & { start(id: string): Promise<RunSummary> };
}

export type SubmissionRunner = ReturnType<typeof createSubmissionRunner>;
