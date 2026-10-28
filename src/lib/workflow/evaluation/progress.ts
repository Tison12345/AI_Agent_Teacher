import { z } from "zod";
import { mergeTrace as mergeTraceItems, notStarted, projectSteps, type ProgressSpec, type SnapshotView as CoreSnapshot } from "../progress-core";

/*
 * What the browser may learn about a weekly evaluation's workflow. Like the submission workflow, this is an
 * allowlist: step names and statuses, an attempt number, waiting-for-teacher, and a fixed sentence per failure.
 * The graph's own state also holds the GitHub diff, the AI's raw output and score and validation issues. None of
 * those are read here, so the student who triggers an evaluation never learns the AI's suggested score.
 */

export const EVALUATION_NODES = [
  "load_context",
  "fetch_diff",
  "generate",
  "check_evaluation",
  "save_evaluation",
  "await_faculty",
  "finish",
  "park_failed",
] as const;
export const EvaluationNodeSchema = z.enum(EVALUATION_NODES);
export type EvaluationNode = z.infer<typeof EvaluationNodeSchema>;

export const EVALUATION_FAILURE_CODES = [
  "precondition",
  "github_failed",
  "github_rate_limited",
  "ai_unavailable",
  "ai_rate_limited",
  "ai_quota",
  "ai_invalid",
  "save_failed",
  "unexpected",
] as const;
export const EvaluationFailureCodeSchema = z.enum(EVALUATION_FAILURE_CODES);
export type EvaluationFailureCode = z.infer<typeof EvaluationFailureCodeSchema>;

export const EvaluationTraceEntrySchema = z.object({
  run: z.number().int(),
  node: EvaluationNodeSchema,
  attempt: z.number().int(),
  result: z.enum(["ok", "retry", "failed"]),
});
export type EvaluationTraceEntry = z.infer<typeof EvaluationTraceEntrySchema>;

export const mergeTrace = (current: EvaluationTraceEntry[], incoming: EvaluationTraceEntry[]) => mergeTraceItems(current, incoming);

/** The sentence shown for each failure. Raw errors never reach the browser. */
export const EVALUATION_FAILURE_MESSAGES: Record<EvaluationFailureCode, string> = {
  precondition: "This week can't be evaluated yet. Check that it is recorded and that the project has a plan.",
  github_failed: "Your code changes could not be fetched from GitHub.",
  github_rate_limited: "GitHub's rate limit was reached. Please try again later.",
  ai_unavailable: "The AI review service could not be reached.",
  ai_rate_limited: "The AI service is rate limiting requests. Please wait a minute and try again.",
  ai_quota: "The AI service's daily free limit has been used up. Try again tomorrow, or ask the administrator to use another key.",
  ai_invalid: "The AI review could not be completed.",
  save_failed: "The review could not be saved.",
  unexpected: "Something went wrong while evaluating this week.",
};

export const EVALUATION_STEPS = [
  { id: "load_context", label: "Loading the week's plan and checkpoint" },
  { id: "fetch_diff", label: "Fetching your code changes" },
  { id: "generate", label: "AI review" },
  { id: "check_evaluation", label: "Checking the review" },
  { id: "save_evaluation", label: "Saving it for teacher review" },
  { id: "await_faculty", label: "Teacher review" },
  { id: "finish", label: "Finished" },
] as const satisfies readonly { id: EvaluationNode; label: string }[];

export const EvaluationProgressSchema = z.object({
  state: z.enum(["not_started", "running", "waiting_faculty", "complete", "failed", "skipped"]),
  steps: z.array(
    z.object({
      id: EvaluationNodeSchema,
      label: z.string(),
      status: z.enum(["done", "active", "waiting", "pending", "failed", "skipped"]),
      attempt: z.number().int().optional(),
    }),
  ),
  failure: z.object({ code: EvaluationFailureCodeSchema, message: z.string() }).nullable(),
  /** Which run this is (1 for the first). Lets a page that just started a run ignore the previous run's ending. */
  run: z.number().int(),
});
export type EvaluationProgress = z.infer<typeof EvaluationProgressSchema>;

export type EvaluationSnapshotView = CoreSnapshot<EvaluationFailureCode, EvaluationNode>;

const SPEC: ProgressSpec<EvaluationNode, EvaluationFailureCode> = {
  steps: EVALUATION_STEPS,
  waitingNode: "await_faculty",
  terminalOutcomes: ["failed", "complete", "skipped"],
  messages: EVALUATION_FAILURE_MESSAGES,
};

export const notStartedEvaluationProgress = (): EvaluationProgress => ({ ...(notStarted(SPEC) as Omit<EvaluationProgress, "run">), run: 0 });
export const projectEvaluationProgress = (snapshot: EvaluationSnapshotView | null): EvaluationProgress => ({
  ...(projectSteps(SPEC, snapshot) as Omit<EvaluationProgress, "run">),
  run: snapshot?.values.run ?? 0,
});
