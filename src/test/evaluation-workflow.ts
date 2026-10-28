// Test-only: memory stores, a scripted GitHub and a scripted Gemini for the weekly evaluation workflow, shared by
// its unit tests and its live test.
import { vi } from "vitest";
import { STRONG, WEEK, modelAnswer } from "@/lib/evaluation/fixtures";
import type { CompareResult } from "@/lib/github/client";
import type { Checkpoint } from "@/lib/schemas/checkpoint";
import type { StoredPlan } from "@/lib/schemas/weekly-plan";
import type { EvaluationGraphDeps } from "@/lib/workflow/evaluation/graph";
import { memoryStore } from "@/test/memory-checkpoint-store";
import { memoryEvaluationStore } from "@/test/memory-evaluation-store";

export const PROJECT = "123e4567-e89b-42d3-a456-426614174000";
export const sha = (c: string) => c.repeat(40);

export const plan: StoredPlan = {
  projectId: PROJECT,
  model: "m",
  generatedAt: "2026-10-26T10:00:00+00:00",
  plan: Array.from({ length: 12 }, (_, i) => ({ ...WEEK, weekNumber: i + 1, title: i === 0 ? "Plan the App" : i === 1 ? WEEK.title : `Week ${i + 1}` })),
};

export const toDiff = (snapshot: typeof STRONG): CompareResult =>
  ({
    status: "ahead",
    aheadBy: 2,
    behindBy: 0,
    totalCommits: 2,
    baseSha: snapshot.baseSha,
    headSha: snapshot.headSha,
    isEmpty: false,
    files: snapshot.files.map((f) => ({ ...f })),
    totalFiles: snapshot.totalFiles,
    totalAdditions: snapshot.totalAdditions,
    totalDeletions: snapshot.totalDeletions,
    filesOmitted: snapshot.filesOmitted,
    patchChars: 0,
    truncated: snapshot.truncated,
  }) as CompareResult;

/** A good model answer (raw JSON text), and one that is not JSON at all, which the checks refuse. */
export const goodAnswer = () => JSON.stringify(modelAnswer([36, 30, 28]));
export const badAnswer = () => "not json";

export type Script = Array<string | Error>;

/**
 * Memory stores and scripted services. `gemini` lists what the model answers in turn (the last one repeats);
 * `github` lists what GitHub answers (an Error is thrown; the last one repeats).
 */
export function evaluationHarness(options: { gemini?: Script; github?: Array<CompareResult | Error> } = {}) {
  const checkpoints = memoryStore();
  const evaluations = memoryEvaluationStore();
  const geminiScript = [...(options.gemini ?? [goodAnswer()])];
  const githubScript = [...(options.github ?? [toDiff(STRONG)])];

  const requestEvaluation = vi.fn(async (...args: [input: unknown, issues: string | undefined, signal?: AbortSignal]) => {
    void args;
    const next = geminiScript.length > 1 ? geminiScript.shift()! : geminiScript[0];
    if (next instanceof Error) throw next;
    return next;
  });
  const compareCommits = vi.fn(async () => {
    const next = githubScript.length > 1 ? githubScript.shift()! : githubScript[0];
    if (next instanceof Error) throw next;
    return next;
  });
  const deps: EvaluationGraphDeps = {
    context: { checkpoints: checkpoints.store, evaluations: evaluations.store, getPlan: async () => plan },
    evaluations: evaluations.store,
    github: { compareCommits: compareCommits as never },
    requestEvaluation,
    model: "eval-model",
  };

  async function record(week: number): Promise<Checkpoint> {
    return checkpoints.store.insertCheckpoint({
      projectId: PROJECT,
      weekNumber: week,
      commitSha: sha(String(week)),
      baseCommitSha: sha(String(week - 1)),
      branch: "main",
      filesChanged: 2,
      additions: 20,
      deletions: 0,
    });
  }
  const target = (checkpoint: Checkpoint, owner = "octocat", repo = "hello-world") => ({
    projectId: PROJECT,
    weekNumber: checkpoint.weekNumber,
    checkpointId: checkpoint.id,
    owner,
    repo,
  });
  /** Pretends the teacher decided (what decide_evaluation does to the evaluation's status). */
  const decide = (weekNumber: number, status: "approved" | "edited" | "rejected" = "approved") => {
    const row = evaluations.rows.find((r) => r.evaluation.weekNumber === weekNumber);
    if (!row) throw new Error("no evaluation to decide");
    row.evaluation = { ...row.evaluation, status };
  };
  return { checkpoints, evaluations, deps, requestEvaluation, compareCommits, record, target, decide };
}
