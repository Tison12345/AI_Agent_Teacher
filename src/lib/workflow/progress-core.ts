/*
 * The part of "graph state → what the browser may see" that every workflow shares. Each workflow supplies its own
 * steps, failure codes and sentences, and calls projectSteps(); nothing here reads a field that is not listed in
 * SnapshotView, which is what keeps checkpoint contents (text, AI output, diffs, scores) out of the browser.
 */

export type StepStatus = "done" | "active" | "waiting" | "pending" | "failed" | "skipped";

/** One node's result in one run. `result` "retry" means the work ran but will be done again (a corrected attempt). */
export type TraceItem<Node extends string = string> = {
  run: number;
  node: Node;
  attempt: number;
  result: "ok" | "retry" | "failed";
};

const key = (entry: TraceItem) => `${entry.run}:${entry.node}:${entry.attempt}`;

/** Appends entries, dropping any already there (a node re-run after a crash cannot add its entry twice). */
export function mergeTrace<T extends TraceItem>(current: T[], incoming: T[]): T[] {
  const seen = new Set(current.map(key));
  const merged = [...current];
  for (const entry of incoming) {
    if (seen.has(key(entry))) continue;
    seen.add(key(entry));
    merged.push(entry);
  }
  // Only the current and the previous run are kept, so a thread that is retried many times stays small.
  const latest = merged.reduce((max, entry) => Math.max(max, entry.run), 0);
  return merged.filter((entry) => entry.run >= latest - 1);
}

/** The parts of the graph's snapshot that the projection reads. Everything else in the snapshot is ignored. */
export type SnapshotView<Code extends string = string, Node extends string = string> = {
  values: {
    run?: number;
    outcome?: string;
    failureCode?: Code | null;
    trace?: TraceItem<Node>[];
  };
  /** The nodes the graph will run next. */
  next: string[];
  /** True while the graph is paused at an interrupt. */
  interrupted: boolean;
};

export type Step<Node extends string> = { id: Node; label: string; status: StepStatus; attempt?: number };

export type ProjectedProgress<Node extends string, Code extends string> = {
  /** not_started | running | waiting_faculty, or the run's terminal outcome. */
  state: string;
  steps: Step<Node>[];
  failure: { code: Code; message: string } | null;
};

export type ProgressSpec<Node extends string, Code extends string> = {
  steps: readonly { id: Node; label: string }[];
  /** The step that waits for a person: shown as "waiting" while the graph is paused at its interrupt. */
  waitingNode: Node;
  /** Outcomes that end the run. Any other outcome means the run is still going. */
  terminalOutcomes: readonly string[];
  messages: Record<Code, string>;
};

export function notStarted<Node extends string, Code extends string>(spec: ProgressSpec<Node, Code>): ProjectedProgress<Node, Code> {
  return { state: "not_started", steps: spec.steps.map((step) => ({ id: step.id, label: step.label, status: "pending" as const })), failure: null };
}

/** Builds the allowlisted progress from a graph snapshot. */
export function projectSteps<Node extends string, Code extends string>(
  spec: ProgressSpec<Node, Code>,
  snapshot: SnapshotView<Code, Node> | null,
): ProjectedProgress<Node, Code> {
  const values = snapshot?.values;
  if (!snapshot || !values || !values.run) return notStarted(spec);

  const run = values.run;
  const trace = (Array.isArray(values.trace) ? values.trace : []).filter((entry) => entry.run === run);
  const outcome = values.outcome ?? "running";
  const terminal = spec.terminalOutcomes.includes(outcome);
  const active = terminal ? undefined : snapshot.next[0];

  const steps: Step<Node>[] = spec.steps.map((step) => {
    const entries = trace.filter((entry) => entry.node === step.id);
    const attempts = entries.reduce((max, entry) => Math.max(max, entry.attempt), 0);
    let status: StepStatus = "pending";
    if (entries.some((entry) => entry.result === "failed")) status = "failed";
    else if (entries.some((entry) => entry.result === "ok")) status = "done";
    if (active === step.id) status = step.id === spec.waitingNode && snapshot.interrupted ? "waiting" : "active";
    return { id: step.id, label: step.label, status, ...(attempts > 1 ? { attempt: attempts } : {}) };
  });

  // A run that ended early leaves the steps it never reached as skipped, not pending.
  if (terminal) for (const step of steps) if (step.status === "pending") step.status = "skipped";

  const failure = outcome === "failed" && values.failureCode ? { code: values.failureCode, message: spec.messages[values.failureCode] } : null;
  const state = terminal ? outcome : snapshot.interrupted ? "waiting_faculty" : "running";
  return { state, steps, failure };
}
