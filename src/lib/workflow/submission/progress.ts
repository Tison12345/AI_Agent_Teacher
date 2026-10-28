import { z } from "zod";

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

export const traceKey = (entry: TraceEntry) => `${entry.run}:${entry.node}:${entry.attempt}`;

/** Appends entries, dropping any that are already there (a node re-run after a crash cannot add its entry twice). */
export function mergeTrace(current: TraceEntry[], incoming: TraceEntry[]): TraceEntry[] {
  const seen = new Set(current.map(traceKey));
  const merged = [...current];
  for (const entry of incoming) {
    if (seen.has(traceKey(entry))) continue;
    seen.add(traceKey(entry));
    merged.push(entry);
  }
  // Only the current and the previous run are kept, so a thread that is retried many times stays small.
  const latest = merged.reduce((max, entry) => Math.max(max, entry.run), 0);
  return merged.filter((entry) => entry.run >= latest - 1);
}

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

/** The parts of the graph's snapshot that the projection reads. Everything else in the snapshot is ignored. */
export type SnapshotView = {
  values: {
    run?: number;
    outcome?: string;
    failureCode?: FailureCode | null;
    trace?: TraceEntry[];
  };
  /** The nodes the graph will run next. */
  next: string[];
  /** True while the graph is paused at an interrupt. */
  interrupted: boolean;
};

const NOT_STARTED: WorkflowProgress = {
  state: "not_started",
  steps: STEPS.map((step) => ({ id: step.id, label: step.label, status: "pending" as const })),
  failure: null,
};

export function notStartedProgress(): WorkflowProgress {
  return structuredClone(NOT_STARTED);
}

/** Builds the allowlisted progress from a graph snapshot. */
export function projectProgress(snapshot: SnapshotView | null): WorkflowProgress {
  const values = snapshot?.values;
  if (!snapshot || !values || !values.run) return notStartedProgress();

  const run = values.run;
  const trace = (Array.isArray(values.trace) ? values.trace : []).filter((entry) => entry.run === run);
  const outcome = values.outcome ?? "running";
  const terminal = outcome === "needs_ocr" || outcome === "failed" || outcome === "complete" || outcome === "skipped";
  const active = terminal ? undefined : snapshot.next[0];

  const steps: WorkflowProgress["steps"] = STEPS.map((step) => {
    const entries = trace.filter((entry) => entry.node === step.id);
    const attempts = entries.reduce((max, entry) => Math.max(max, entry.attempt), 0);
    let status: StepStatus = "pending";
    if (entries.some((entry) => entry.result === "failed")) status = "failed";
    else if (entries.some((entry) => entry.result === "ok")) status = "done";
    if (active === step.id) status = step.id === "await_faculty" && snapshot.interrupted ? "waiting" : "active";
    return { id: step.id, label: step.label, status, ...(attempts > 1 ? { attempt: attempts } : {}) };
  });

  // A run that ended early leaves the steps it never reached as skipped, not pending.
  if (terminal) {
    for (const step of steps) if (step.status === "pending") step.status = "skipped";
  }
  const failure =
    outcome === "failed" && values.failureCode ? { code: values.failureCode, message: FAILURE_MESSAGES[values.failureCode] } : null;

  const state: WorkflowProgress["state"] =
    outcome === "failed" || outcome === "needs_ocr" || outcome === "complete" || outcome === "skipped"
      ? outcome
      : snapshot.interrupted
        ? "waiting_faculty"
        : "running";
  return { state, steps, failure };
}
