import { z } from "zod";
import { mergeTrace as mergeTraceItems, notStarted, projectSteps, type ProgressSpec, type SnapshotView as CoreSnapshot } from "../progress-core";

/*
 * What a STUDENT (or the browser in general) may learn about a submission's workflow. This file is the only
 * place where graph state becomes something that leaves the server, and it is an allowlist: node names,
 * step statuses, an attempt number, whether the run waits for faculty, and a fixed sentence per failure code.
 * The graph's own state also holds the extracted-text summary, the AI's raw output and recommendation, and
 * validation issues. None of those are read here.
 */

export const WORKFLOW_NODES = [
  "extract_text",
  "check_readable",
  "grade",
  "check_grade",
  "save_result",
  "await_faculty",
  "finish",
  "park_failed",
  "needs_ocr",
] as const;
export const WorkflowNodeSchema = z.enum(WORKFLOW_NODES);
export type WorkflowNode = z.infer<typeof WorkflowNodeSchema>;

export const FAILURE_CODES = ["read_failed", "marking_unavailable", "marking_invalid", "save_failed", "unexpected"] as const;
export const FailureCodeSchema = z.enum(FAILURE_CODES);
export type FailureCode = z.infer<typeof FailureCodeSchema>;

/** One node's result in one run. `result` "retry" means the work ran but will be done again (a corrected attempt). */
export const TraceEntrySchema = z.object({
  run: z.number().int(),
  node: WorkflowNodeSchema,
  attempt: z.number().int(),
  result: z.enum(["ok", "retry", "failed"]),
});
export type TraceEntry = z.infer<typeof TraceEntrySchema>;

/** Appends entries, dropping any that are already there (see progress-core). */
export const mergeTrace = (current: TraceEntry[], incoming: TraceEntry[]): TraceEntry[] => mergeTraceItems(current, incoming);

/** The sentence shown for each failure. Raw errors never reach the browser. */
export const FAILURE_MESSAGES: Record<FailureCode, string> = {
  read_failed: "Your file could not be read.",
  marking_unavailable: "The AI marking service could not be reached.",
  marking_invalid: "The AI marking could not be completed.",
  save_failed: "The marking result could not be saved.",
  unexpected: "Something went wrong while processing your submission.",
};

export const STEPS = [
  { id: "extract_text", label: "Reading your file" },
  { id: "check_readable", label: "Checking the text can be read" },
  { id: "grade", label: "AI marking" },
  { id: "check_grade", label: "Checking the marking" },
  { id: "save_result", label: "Saving the recommendation" },
  { id: "await_faculty", label: "Faculty review" },
  { id: "finish", label: "Finished" },
] as const satisfies readonly { id: WorkflowNode; label: string }[];

export const StepStatusSchema = z.enum(["done", "active", "waiting", "pending", "failed", "skipped"]);
export const WorkflowProgressSchema = z.object({
  state: z.enum(["not_started", "running", "waiting_faculty", "complete", "needs_ocr", "failed", "skipped"]),
  steps: z.array(
    z.object({
      id: WorkflowNodeSchema,
      label: z.string(),
      status: StepStatusSchema,
      /** Only present once a step has been done more than once (a corrected marking attempt). */
      attempt: z.number().int().optional(),
    }),
  ),
  failure: z.object({ code: FailureCodeSchema, message: z.string() }).nullable(),
});
export type WorkflowProgress = z.infer<typeof WorkflowProgressSchema>;
export type StepStatus = z.infer<typeof StepStatusSchema>;

export type SnapshotView = CoreSnapshot<FailureCode, WorkflowNode>;

const SPEC: ProgressSpec<WorkflowNode, FailureCode> = {
  steps: STEPS,
  waitingNode: "await_faculty",
  terminalOutcomes: ["needs_ocr", "failed", "complete", "skipped"],
  messages: FAILURE_MESSAGES,
};

export function notStartedProgress(): WorkflowProgress {
  return notStarted(SPEC) as WorkflowProgress;
}

/** Builds the allowlisted progress from a graph snapshot. */
export function projectProgress(snapshot: SnapshotView | null): WorkflowProgress {
  return projectSteps(SPEC, snapshot) as WorkflowProgress;
}
