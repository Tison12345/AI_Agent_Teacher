import { NodeTimeoutError } from "@langchain/langgraph";
import { EvaluationConflictError, EvaluationError } from "@/lib/evaluation/service";
import { GeminiError } from "@/lib/gemini/errors";
import { GitHubError } from "@/lib/github/errors";
import type { LeaseOptions, LeaseStore } from "../lease";
import { createRunner } from "../runner-core";
import { freshEvaluationInput, type EvaluationGraph, type EvaluationStateValues, type EvaluationTarget } from "./graph";
import { EVALUATION_NODES, projectEvaluationProgress, type EvaluationFailureCode, type EvaluationNode } from "./progress";

export const evaluationThread = (checkpointId: string) => `evaluation:${checkpointId}`;

const GENERIC = "The evaluation could not be completed. Please try again.";

type Classified = { code: EvaluationFailureCode; reason: string };

/** Turns an error into the failure code and a stored reason. Only our own wording is kept; raw details are logged. */
export function classifyEvaluationFailure(error: unknown, node: EvaluationNode | undefined): Classified {
  if (error instanceof EvaluationError) return { code: "precondition", reason: error.message };
  if (error instanceof GitHubError) return { code: error.code === "rate_limited" ? "github_rate_limited" : "github_failed", reason: error.message };
  if (error instanceof GeminiError) {
    const code = error.code === "quota_exhausted" ? "ai_quota" : error.code === "rate_limited" ? "ai_rate_limited" : "ai_unavailable";
    return { code, reason: error.message };
  }
  if (error instanceof NodeTimeoutError) return { code: "ai_unavailable", reason: new GeminiError("timeout").message };
  if (error instanceof EvaluationConflictError) return { code: "save_failed", reason: "Another evaluation was saved first." };
  console.error("[workflow] unexpected error in", node ?? "unknown node", ":", error instanceof Error ? error.name : "unknown");
  return { code: node === "save_evaluation" ? "save_failed" : "unexpected", reason: GENERIC };
}

export type EvaluationRunnerOptions = {
  graph: EvaluationGraph;
  leases: LeaseStore;
  lease?: Partial<LeaseOptions>;
  sleep?: (ms: number) => Promise<void>;
};

export function createEvaluationRunner(options: EvaluationRunnerOptions) {
  const core = createRunner({
    graph: options.graph,
    leases: options.leases,
    lease: options.lease,
    sleep: options.sleep,
    threadId: evaluationThread,
    freshInput: (_checkpointId, run, target) => freshEvaluationInput(target as EvaluationTarget, run),
    project: projectEvaluationProgress,
    describeFailure(_checkpointId, error, pending, values) {
      const node = EVALUATION_NODES.find((name) => name === pending);
      const failure = classifyEvaluationFailure(error, node);
      const state = values as Partial<EvaluationStateValues>;
      const attempt = node === "generate" ? (state.attempt ?? 0) + 1 : node === "check_evaluation" ? (state.attempt ?? 0) : 1;
      return {
        update: {
          failureCode: failure.code,
          failureReason: failure.reason,
          trace: node ? [{ run: state.run ?? 1, node, attempt, result: "failed" }] : [],
        },
        // Nothing is stored in the database before every check has passed, so there is nothing to mark.
        lastResort: async () => {},
      };
    },
  });
  return {
    ...core,
    /** Starts a new run for a recorded checkpoint. Throws LeaseHeldError when one is already running. */
    start: (target: EvaluationTarget) => core.start(target.checkpointId, target) as Promise<{ outcome: EvaluationStateValues["outcome"] }>,
  };
}

export type EvaluationRunner = ReturnType<typeof createEvaluationRunner>;
