import "server-only";
import { checkpointStore } from "@/lib/checkpoints/repository";
import { evaluationStore } from "@/lib/evaluation/repository";
import { requestEvaluation } from "@/lib/evaluation/generator";
import { getGeminiClient, getGeminiModel } from "@/lib/gemini/client";
import { getGitHubClient } from "@/lib/github/client";
import { getPlan } from "@/lib/plans/repository";
import type { EvaluationGraphDeps } from "./graph";

/** The real dependencies: Supabase, GitHub (server token) and Gemini (server key). Keys are read when used. */
export function defaultEvaluationGraphDeps(): EvaluationGraphDeps {
  const model = getGeminiModel();
  return {
    context: { checkpoints: checkpointStore, evaluations: evaluationStore, getPlan },
    evaluations: evaluationStore,
    github: { compareCommits: (...args) => getGitHubClient().compareCommits(...args) },
    requestEvaluation: (input, issues, signal) => requestEvaluation(input, issues, { client: getGeminiClient(), model, signal }),
    model,
  };
}
