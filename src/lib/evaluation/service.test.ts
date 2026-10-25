import { ApiError } from "@google/genai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GeminiClient } from "@/lib/gemini/client";
import { GitHubError } from "@/lib/github/errors";
import type { Checkpoint } from "@/lib/schemas/checkpoint";
import type { StoredPlan } from "@/lib/schemas/weekly-plan";
import { memoryEvaluationStore } from "@/test/memory-evaluation-store";
import { memoryStore } from "@/test/memory-checkpoint-store";
import { PARTIAL, STRONG, UNREADABLE, WEEK, modelAnswer } from "./fixtures";
import { EVALUATION_DIFF_LIMITS } from "./prompt";
import { EvaluationError, evaluateWeek, type EvaluationDeps } from "./service";

const PROJECT = "123e4567-e89b-42d3-a456-426614174000";
const target = (weekNumber = 2) => ({ projectId: PROJECT, owner: "octocat", repo: "hello-world", weekNumber });
const sha = (c: string) => c.repeat(40);

const plan: StoredPlan = {
  projectId: PROJECT,
  model: "m",
  generatedAt: "2026-10-26T10:00:00+00:00",
  plan: Array.from({ length: 12 }, (_, i) => ({
    ...WEEK,
    weekNumber: i + 1,
    title: i === 0 ? "Plan the App" : i === 1 ? WEEK.title : `Week ${i + 1}`,
  })),
};

type Diff = Awaited<ReturnType<EvaluationDeps["github"]["compareCommits"]>>;
const toDiff = (snapshot: typeof STRONG): Diff =>
  ({
    status: "ahead",
    aheadBy: 2,
    behindBy: 0,
    totalCommits: 2,
    baseSha: snapshot.baseSha,
    headSha: snapshot.headSha,
    isEmpty: false,
    files: snapshot.files.map((f) => ({ ...f, patchTruncated: f.patchTruncated })),
    totalFiles: snapshot.totalFiles,
    totalAdditions: snapshot.totalAdditions,
    totalDeletions: snapshot.totalDeletions,
    filesOmitted: snapshot.filesOmitted,
    patchChars: 0,
    truncated: snapshot.truncated,
  }) as Diff;

function geminiReturning(...texts: Array<unknown | Error>) {
  const generateContent = vi.fn();
  for (const t of texts) {
    if (t instanceof Error) generateContent.mockRejectedValueOnce(t);
    else generateContent.mockResolvedValueOnce({ text: JSON.stringify(t) });
  }
  const client: GeminiClient = { models: { generateContent } };
  return { client, generateContent };
}

let checkpoints: ReturnType<typeof memoryStore>;
let evaluations: ReturnType<typeof memoryEvaluationStore>;
let getPlan: ReturnType<typeof vi.fn>;
let compareCommits: ReturnType<typeof vi.fn>;

async function record(week: number, commit: string, base: string): Promise<Checkpoint> {
  return checkpoints.store.insertCheckpoint({
    projectId: PROJECT,
    weekNumber: week,
    commitSha: commit,
    baseCommitSha: base,
    branch: "main",
    filesChanged: 2,
    additions: 20,
    deletions: 0,
  });
}

const deps = (gemini: ReturnType<typeof geminiReturning>): EvaluationDeps => ({
  checkpoints: checkpoints.store,
  evaluations: evaluations.store,
  getPlan: getPlan as never,
  github: { compareCommits: compareCommits as never },
  gemini: { client: gemini.client, model: "eval-model" },
});

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  checkpoints = memoryStore();
  evaluations = memoryEvaluationStore();
  getPlan = vi.fn(async () => plan);
  compareCommits = vi.fn(async () => toDiff(STRONG));
});

const code = (p: Promise<unknown>) =>
  p.then(
    () => "no error",
    (e: unknown) => (e instanceof EvaluationError ? e.code : e instanceof GitHubError ? `github:${e.code}` : `other:${(e as { code?: string }).code ?? "?"}`),
  );

describe("evaluateWeek: preconditions", () => {
  it("needs a recorded checkpoint first", async () => {
    const gemini = geminiReturning(modelAnswer([36, 30, 28]));
    expect(await code(evaluateWeek(target(), deps(gemini)))).toBe("checkpoint_required");
    expect(compareCommits).not.toHaveBeenCalled();
    expect(gemini.generateContent).not.toHaveBeenCalled();
  });

  it("needs the project's plan, because the criteria come from it", async () => {
    await record(2, sha("2"), sha("1"));
    getPlan.mockResolvedValue(null);
    const gemini = geminiReturning(modelAnswer([36, 30, 28]));
    expect(await code(evaluateWeek(target(), deps(gemini)))).toBe("plan_required");
    expect(gemini.generateContent).not.toHaveBeenCalled();
  });
});

describe("evaluateWeek: a recorded week", () => {
  beforeEach(async () => {
    await record(1, sha("1"), sha("0"));
    await record(2, sha("2"), sha("1"));
  });

  it("evaluates the exact commit range of the checkpoint and stores it for teacher review", async () => {
    const gemini = geminiReturning(modelAnswer([36, 30, 28]));
    const { evaluation, snapshot } = await evaluateWeek(target(), deps(gemini));

    // The diff is between the two recorded SHAs, with evaluation limits and source-first ordering.
    expect(compareCommits).toHaveBeenCalledWith("octocat", "hello-world", sha("1"), sha("2"), { ...EVALUATION_DIFF_LIMITS }, true);

    expect(evaluation).toMatchObject({
      weekNumber: 2,
      suggestedScore: 94,
      status: "pending_review",
      model: "eval-model",
    });
    expect(evaluation.reviewScope.codeExecuted).toBe(false);
    // The evidence the AI saw is kept with the evaluation.
    expect(snapshot.files.map((f) => f.path)).toEqual(["src/app.js", "index.html"]);
    expect(snapshot.files[0].patch).toContain("function addBook");
    expect(evaluations.rows).toHaveLength(1);
  });

  it("uses the model named in config for the call, and the plan's week for the rubric", async () => {
    const gemini = geminiReturning(modelAnswer([36, 30, 28]));
    await evaluateWeek(target(), deps(gemini));
    const call = gemini.generateContent.mock.calls[0][0];
    expect(call.model).toBe("eval-model");
    expect(call.contents).toContain("Add a book");
  });

  it("gives week 2 the previous week's title and the open items of week 1's AI review", async () => {
    // Week 1 already has an evaluation with something left undone.
    const week1 = await checkpoints.store.getCheckpoint(PROJECT, 1);
    await evaluations.store.insert({
      projectId: PROJECT,
      checkpointId: week1!.id,
      weekNumber: 1,
      model: "m",
      snapshot: STRONG,
      result: {
        suggestedScore: 70,
        criteriaAssessments: [{ criterion: "Add a book", score: 7, maxScore: 10, rationale: "ok", evidence: [] }],
        completedRequirements: [],
        incompleteRequirements: ["Sketch the screens", "Write the feature list"],
        technicalConcerns: [],
        feedbackForNextWeek: ["Keep going"],
        confidence: { level: "medium", uncertainties: [] },
        reviewScope: { filesChanged: 1, filesReviewed: 1, patchesTruncated: 0, notReviewed: [], filesBeyondLimit: 0, codeExecuted: false },
      },
    });
    const gemini = geminiReturning(modelAnswer([36, 30, 28]));
    await evaluateWeek(target(), deps(gemini));
    const prompt: string = gemini.generateContent.mock.calls[0][0].contents;
    const body = JSON.parse(prompt.replace(/^<review_input>\n/, "").replace(/\n<\/review_input>$/, ""));
    expect(body.previousWeek).toEqual({
      weekNumber: 1,
      title: "Plan the App",
      openItemsFromEarlierAiReview: ["Sketch the screens", "Write the feature list"],
    });
  });

  it("week 1 has no previous-week context", async () => {
    const gemini = geminiReturning(modelAnswer([36, 30, 28]));
    await evaluateWeek(target(1), deps(gemini));
    const prompt: string = gemini.generateContent.mock.calls[0][0].contents;
    expect(JSON.parse(prompt.replace(/^<review_input>\n/, "").replace(/\n<\/review_input>$/, "")).previousWeek).toBeNull();
  });

  it("a partial week yields a lower suggestion and incomplete items", async () => {
    compareCommits.mockResolvedValue(toDiff(PARTIAL));
    const gemini = geminiReturning(modelAnswer([34, 26, 0], { incompleteRequirements: ["Keeping the books after reload"] }));
    const { evaluation } = await evaluateWeek(target(), deps(gemini));
    expect(evaluation.suggestedScore).toBe(60);
    expect(evaluation.incompleteRequirements).toEqual(["Keeping the books after reload"]);
  });

  it("records what could not be read, taken from the real diff", async () => {
    compareCommits.mockResolvedValue(toDiff(UNREADABLE));
    const gemini = geminiReturning(modelAnswer([36, 30, 28]));
    const { evaluation } = await evaluateWeek(target(), deps(gemini));
    expect(evaluation.confidence.level).toBe("medium");
    expect(evaluation.reviewScope.notReviewed.map((f) => f.reason).sort()).toEqual(["binary", "budget", "deleted", "ignored", "unavailable"]);
  });
});

describe("evaluateWeek: one evaluation per checkpoint", () => {
  beforeEach(async () => {
    await record(1, sha("1"), sha("0"));
  });

  it("never replaces an existing evaluation, and does not call GitHub or Gemini again", async () => {
    await evaluateWeek(target(1), deps(geminiReturning(modelAnswer([36, 30, 28]))));
    const original = JSON.stringify(evaluations.rows[0]);

    const gemini = geminiReturning(modelAnswer([0, 0, 0]));
    compareCommits.mockClear();
    const error = await evaluateWeek(target(1), deps(gemini)).catch((e: EvaluationError) => e);
    expect(error).toMatchObject({ code: "evaluation_exists", existingStatus: "pending_review" });
    expect(gemini.generateContent).not.toHaveBeenCalled();
    expect(compareCommits).not.toHaveBeenCalled();
    expect(evaluations.rows).toHaveLength(1);
    expect(JSON.stringify(evaluations.rows[0])).toBe(original);
  });

  it("simultaneous requests store exactly one evaluation", async () => {
    const answers = Array.from({ length: 5 }, () => modelAnswer([36, 30, 28]));
    const gemini = geminiReturning(...answers);
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () => evaluateWeek(target(1), deps(gemini))),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    for (const r of results.filter((x): x is PromiseRejectedResult => x.status === "rejected")) {
      expect(r.reason).toMatchObject({ code: "evaluation_exists" });
    }
    expect(evaluations.rows).toHaveLength(1);
  });
});

describe("evaluateWeek: failures store nothing", () => {
  beforeEach(async () => {
    await record(1, sha("1"), sha("0"));
  });

  it.each([
    ["invalid_ref", "github:invalid_ref"],
    ["not_found", "github:not_found"],
    ["rate_limited", "github:rate_limited"],
    ["timeout", "github:timeout"],
  ] as const)("GitHub %s", async (githubCode, expected) => {
    compareCommits.mockRejectedValue(new GitHubError(githubCode));
    const gemini = geminiReturning(modelAnswer([36, 30, 28]));
    expect(await code(evaluateWeek(target(1), deps(gemini)))).toBe(expected);
    expect(gemini.generateContent).not.toHaveBeenCalled();
    expect(evaluations.rows).toHaveLength(0);
  });

  it.each([
    [429, "rate_limited"],
    [503, "unavailable"],
  ])("Gemini status %i -> %s", async (status, geminiCode) => {
    const gemini = geminiReturning(new ApiError({ message: "x", status }));
    expect(await code(evaluateWeek(target(1), deps(gemini)))).toBe(`other:${geminiCode}`);
    expect(evaluations.rows).toHaveLength(0);
  });

  it("an answer that never passes validation is not stored", async () => {
    const bad = modelAnswer([36, 30, 28], {}, "src/missing.js");
    const gemini = geminiReturning(bad, bad);
    expect(await code(evaluateWeek(target(1), deps(gemini)))).toBe("other:invalid_response");
    expect(evaluations.rows).toHaveLength(0);
  });

  it("a failed attempt can be retried, since nothing was stored", async () => {
    const gemini = geminiReturning(new ApiError({ message: "x", status: 429 }), modelAnswer([36, 30, 28]));
    await expect(evaluateWeek(target(1), deps(gemini))).rejects.toBeDefined();
    const { evaluation } = await evaluateWeek(target(1), deps(gemini));
    expect(evaluation.suggestedScore).toBe(94);
  });
});
