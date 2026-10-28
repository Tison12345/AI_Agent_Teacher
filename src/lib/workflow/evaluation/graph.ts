import { END, interrupt, ReducedValue, START, StateGraph, StateSchema, type BaseCheckpointSaver, type RetryPolicy } from "@langchain/langgraph";
import { z } from "zod";
import { checkEvaluation, MAX_ATTEMPTS } from "@/lib/evaluation/generator";
import { loadEvaluationContext, toSnapshot, type EvaluationDeps, type StoredEvaluation } from "@/lib/evaluation/service";
import { EVALUATION_DIFF_LIMITS, type PromptInput } from "@/lib/evaluation/prompt";
import { GeminiError } from "@/lib/gemini/errors";
import type { CompareResult } from "@/lib/github/client";
import { GitHubError } from "@/lib/github/errors";
import { SnapshotSchema, type Snapshot } from "@/lib/schemas/evaluation";
import { WeeklyPlanItemSchema } from "@/lib/schemas/weekly-plan";
import type { AssembledEvaluation } from "@/lib/evaluation/assemble";
import { EvaluationFailureCodeSchema, EvaluationTraceEntrySchema, mergeTrace, type EvaluationNode, type EvaluationTraceEntry } from "./progress";

/*
 * The weekly evaluation workflow, one thread per recorded checkpoint ("evaluation:<checkpoint id>").
 *
 *   load_context → fetch_diff → generate → check_evaluation → save_evaluation → await_faculty → finish
 *                                  ↑               │                              (interrupt)
 *                                  └───────────────┘ (one corrected retry)
 *   any failure → park_failed
 *
 * The database stays the authority: the evaluation row is inserted once (never rewritten), and the teacher's
 * official decision is made by decide_evaluation, outside the graph. The graph only learns that a decision
 * exists. The checkpoint holds the working state for this run (the GitHub diff, the model's raw answer and checked
 * result, attempt numbers); it is server-only and never reaches a browser.
 */

const PreviousSchema = z
  .object({ weekNumber: z.number().int(), title: z.string(), openItemsFromEarlierAiReview: z.array(z.string()) })
  .nullable();

export const EvaluationState = new StateSchema({
  projectId: z.string().default(""),
  weekNumber: z.number().int().default(0),
  checkpointId: z.string().default(""),
  owner: z.string().default(""),
  repo: z.string().default(""),
  run: z.number().int().default(0),
  /** running while the graph works; skipped when the checkpoint has no evaluation to make any more. */
  outcome: z.enum(["running", "skipped", "failed", "complete"]).default("running"),
  baseSha: z.string().nullable().default(null),
  headSha: z.string().nullable().default(null),
  week: WeeklyPlanItemSchema.nullable().default(null),
  previous: PreviousSchema.default(null),
  /** The GitHub diff for this run (decision 3: it stays in the graph state for the current run). */
  snapshot: SnapshotSchema.nullable().default(null),
  attempt: z.number().int().default(0),
  issues: z.string().nullable().default(null),
  rawEvaluation: z.string().nullable().default(null),
  result: z.custom<AssembledEvaluation>().nullable().default(null),
  evaluationId: z.string().nullable().default(null),
  decided: z.boolean().default(false),
  failureCode: EvaluationFailureCodeSchema.nullable().default(null),
  failureReason: z.string().nullable().default(null),
  trace: new ReducedValue(z.array(EvaluationTraceEntrySchema).default(() => []), { reducer: mergeTrace }),
});
export type EvaluationStateValues = typeof EvaluationState.State;

export type EvaluationTarget = { projectId: string; weekNumber: number; checkpointId: string; owner: string; repo: string };

/** The fields a new run starts from. */
export const freshEvaluationInput = (target: EvaluationTarget, run: number): Partial<EvaluationStateValues> => ({
  ...target,
  run,
  outcome: "running",
  baseSha: null,
  headSha: null,
  week: null,
  previous: null,
  snapshot: null,
  attempt: 0,
  issues: null,
  rawEvaluation: null,
  result: null,
  evaluationId: null,
  decided: false,
  failureCode: null,
  failureReason: null,
});

export type EvaluationGraphDeps = {
  context: EvaluationDeps;
  github: {
    compareCommits(
      owner: string,
      repo: string,
      base: string,
      head: string,
      limits: typeof EVALUATION_DIFF_LIMITS,
      prioritize: boolean,
      abort?: AbortSignal,
    ): Promise<CompareResult>;
  };
  requestEvaluation(input: PromptInput, issues: string | undefined, signal?: AbortSignal): Promise<string | undefined>;
  evaluations: EvaluationDeps["evaluations"];
  model: string;
};

/** One transient failure (a timeout or a 503) is tried again once. A 429 or rate limit never is. */
const transient = (error: unknown) =>
  (error instanceof GeminiError && (error.code === "timeout" || error.code === "unavailable")) ||
  (error instanceof GitHubError && (error.code === "timeout" || error.code === "unavailable"));
export const TRANSIENT_RETRY: RetryPolicy = { maxAttempts: 2, initialInterval: 1_000, maxInterval: 5_000, jitter: false, logWarning: false, retryOn: transient };

const entry = (state: EvaluationStateValues, node: EvaluationNode, attempt = 1, result: EvaluationTraceEntry["result"] = "ok"): EvaluationTraceEntry[] => [
  { run: state.run, node, attempt, result },
];

// ---- The graph ---------------------------------------------------------------------------------------

export function buildEvaluationGraph(deps: EvaluationGraphDeps, saver: BaseCheckpointSaver) {
  const failed = (state: { failureReason: string | null }) => state.failureReason !== null;
  const promptInput = (state: EvaluationStateValues): PromptInput => {
    if (!state.week || !state.snapshot) throw new Error("the review was started without its plan week or code changes");
    return { weekNumber: state.weekNumber, week: state.week, previous: state.previous, snapshot: state.snapshot };
  };
  const statusOf = async (checkpointId: string): Promise<StoredEvaluation | null> => deps.evaluations.getByCheckpoint(checkpointId);

  return new StateGraph(EvaluationState)
    .addNode("load_context", async (state) => {
      const { checkpoint, week, previous } = await loadEvaluationContext({ projectId: state.projectId, weekNumber: state.weekNumber }, deps.context);
      return { baseSha: checkpoint.baseCommitSha, headSha: checkpoint.commitSha, week, previous, trace: entry(state, "load_context") };
    })

    .addNode(
      "fetch_diff",
      async (state: EvaluationStateValues, config) => {
        // The diff is always between the two recorded SHAs. Commit messages are never read.
        const diff = await deps.github.compareCommits(
          state.owner,
          state.repo,
          state.baseSha ?? "",
          state.headSha ?? "",
          { ...EVALUATION_DIFF_LIMITS },
          true,
          config.signal,
        );
        return { snapshot: toSnapshot(diff) satisfies Snapshot, trace: entry(state, "fetch_diff") };
      },
      { retryPolicy: TRANSIENT_RETRY },
    )

    .addNode(
      "generate",
      async (state: EvaluationStateValues, config) => {
        const raw = await deps.requestEvaluation(promptInput(state), state.issues ?? undefined, config.signal);
        const attempt = state.attempt + 1;
        return { rawEvaluation: raw ?? "", attempt, trace: entry(state, "generate", attempt) };
      },
      { retryPolicy: TRANSIENT_RETRY, timeout: 90_000 },
    )

    .addNode("check_evaluation", (state) => {
      const checked = checkEvaluation(state.rawEvaluation ?? "", promptInput(state), state.attempt);
      if (checked.ok) return { result: checked.value, rawEvaluation: null, issues: null, trace: entry(state, "check_evaluation", state.attempt) };
      if (state.attempt < MAX_ATTEMPTS) {
        return { rawEvaluation: null, issues: checked.issues, trace: entry(state, "check_evaluation", state.attempt, "retry") };
      }
      return {
        rawEvaluation: null,
        failureCode: "ai_invalid" as const,
        failureReason: new GeminiError("invalid_response").message,
        trace: entry(state, "check_evaluation", state.attempt, "failed"),
      };
    })

    .addNode("save_evaluation", async (state) => {
      if (!state.result || !state.snapshot) throw new Error("save_evaluation reached without a checked review");
      // Rerun safety: the row is inserted once. If an earlier attempt of this step already inserted it (the
      // process stopped before the checkpoint was written), that row is ours; nothing is inserted twice.
      const existing = await statusOf(state.checkpointId);
      const stored =
        existing ??
        (await deps.evaluations.insert({
          projectId: state.projectId,
          checkpointId: state.checkpointId,
          weekNumber: state.weekNumber,
          result: state.result,
          snapshot: state.snapshot,
          model: deps.model,
        }));
      return { evaluationId: stored.evaluation.id, trace: entry(state, "save_evaluation") };
    })

    .addNode("await_faculty", async (state) => {
      // Everything before interrupt() runs again on resume, so it only reads. A decision made before the graph
      // got here (or while it was being resumed) is seen here, and nothing waits for it.
      const pending = async () => (await statusOf(state.checkpointId))?.evaluation.status === "pending_review";
      if (await pending()) interrupt({ kind: "teacher_review" });
      // The decision itself is made by decide_evaluation; the graph only learns that it exists.
      const decided = !(await pending());
      return { decided, ...(decided ? { trace: entry(state, "await_faculty") } : {}) };
    })

    .addNode("finish", (state) => ({ outcome: "complete" as const, trace: entry(state, "finish") }))

    // Nothing to undo in the database: the evaluation row is only inserted after every check has passed.
    .addNode("park_failed", (state) => ({ outcome: "failed" as const, trace: entry(state, "park_failed") }))

    .addEdge(START, "load_context")
    .addConditionalEdges("load_context", (state) => (failed(state) ? "park_failed" : "fetch_diff"), ["park_failed", "fetch_diff"])
    .addConditionalEdges("fetch_diff", (state) => (failed(state) ? "park_failed" : "generate"), ["park_failed", "generate"])
    .addConditionalEdges("generate", (state) => (failed(state) ? "park_failed" : "check_evaluation"), ["park_failed", "check_evaluation"])
    .addConditionalEdges(
      "check_evaluation",
      (state) => (failed(state) ? "park_failed" : state.result ? "save_evaluation" : "generate"),
      ["park_failed", "save_evaluation", "generate"],
    )
    .addConditionalEdges("save_evaluation", (state) => (failed(state) ? "park_failed" : "await_faculty"), ["park_failed", "await_faculty"])
    .addConditionalEdges("await_faculty", (state) => (state.decided ? "finish" : "await_faculty"), ["finish", "await_faculty"])
    .addEdge("finish", END)
    .addEdge("park_failed", END)
    .compile({ checkpointer: saver });
}

export type EvaluationGraph = ReturnType<typeof buildEvaluationGraph>;
