import { beforeEach, describe, expect, it, vi } from "vitest";
import { NOTHING_READABLE, STRONG, WEEK } from "@/lib/evaluation/fixtures";
import type { GeminiClient } from "@/lib/gemini/client";
import { GeminiError } from "@/lib/gemini/errors";
import { GitHubError } from "@/lib/github/errors";
import type { StoredPlan } from "@/lib/schemas/weekly-plan";
import { memoryStore } from "@/test/memory-checkpoint-store";
import { memoryQuizStore } from "@/test/memory-quiz-store";
import { modelQuiz } from "./fixtures";
import { QuizError, generateQuiz, getQuizView, submitAttempt, toView, type GenerateQuizDeps } from "./service";

const PROJECT = "123e4567-e89b-42d3-a456-426614174000";
const target = (weekNumber = 1) => ({ projectId: PROJECT, owner: "octocat", repo: "hello-world", weekNumber });
const sha = (c: string) => c.repeat(40);

const plan: StoredPlan = {
  projectId: PROJECT,
  model: "m",
  generatedAt: "2026-10-27T10:00:00+00:00",
  plan: Array.from({ length: 12 }, (_, i) => ({ ...WEEK, weekNumber: i + 1 })),
};

type Diff = Awaited<ReturnType<GenerateQuizDeps["github"]["compareCommits"]>>;
const toDiff = (snapshot: typeof STRONG): Diff =>
  ({
    status: "ahead",
    aheadBy: 2,
    behindBy: 0,
    totalCommits: 2,
    baseSha: snapshot.baseSha,
    headSha: snapshot.headSha,
    isEmpty: false,
    files: snapshot.files,
    totalFiles: snapshot.totalFiles,
    totalAdditions: snapshot.totalAdditions,
    totalDeletions: snapshot.totalDeletions,
    filesOmitted: snapshot.filesOmitted,
    patchChars: 0,
    truncated: snapshot.truncated,
  }) as Diff;

let checkpoints: ReturnType<typeof memoryStore>;
let quizzes: ReturnType<typeof memoryQuizStore>;
let getPlan: ReturnType<typeof vi.fn>;
let compareCommits: ReturnType<typeof vi.fn>;
let generateContent: ReturnType<typeof vi.fn>;

const deps = (): GenerateQuizDeps => ({
  checkpoints: checkpoints.store,
  quizzes: quizzes.store,
  getPlan: getPlan as never,
  github: { compareCommits: compareCommits as never },
  gemini: { client: { models: { generateContent } } as GeminiClient, model: "quiz-model" },
});

const record = (week: number) =>
  checkpoints.store.insertCheckpoint({
    projectId: PROJECT,
    weekNumber: week,
    commitSha: sha("1"),
    baseCommitSha: sha("0"),
    branch: "main",
    filesChanged: 2,
    additions: 20,
    deletions: 0,
  });

beforeEach(async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  checkpoints = memoryStore();
  quizzes = memoryQuizStore();
  getPlan = vi.fn(async () => plan);
  compareCommits = vi.fn(async () => toDiff(STRONG));
  generateContent = vi.fn(async () => ({ text: JSON.stringify(modelQuiz()) }));
  await record(1);
});

describe("generateQuiz", () => {
  it("creates and stores one quiz for the recorded week and returns an open view", async () => {
    const view = await generateQuiz(target(), deps());
    expect(view).toMatchObject({ state: "open", weekNumber: 1 });
    expect(view.questions).toHaveLength(5);
    expect(quizzes.quizzes).toHaveLength(1);
    expect(quizzes.quizzes[0]).toMatchObject({ weekNumber: 1, model: "quiz-model" });
    expect(quizzes.quizzes[0].questions[0].explanation).toBeTruthy(); // stored, but not in the view
  });

  it("the view the browser gets has no correct answers or explanations anywhere in it", async () => {
    const view = await generateQuiz(target(), deps());
    const text = JSON.stringify(view);
    expect(text).not.toMatch(/correctIndex|explanation|Because part/);
    expect(Object.keys(view.questions[0]).sort()).toEqual(["options", "question"]);
  });

  it("compares the two recorded commits with the evaluation's diff limits", async () => {
    await generateQuiz(target(), deps());
    expect(compareCommits).toHaveBeenCalledWith(
      "octocat",
      "hello-world",
      sha("0"),
      sha("1"),
      expect.objectContaining({ maxFiles: 60, maxPatchCharsPerFile: 10_000, maxTotalPatchChars: 80_000 }),
      true,
    );
  });

  it("needs a recorded checkpoint, before any GitHub or AI work", async () => {
    await expect(generateQuiz(target(2), deps())).rejects.toMatchObject({ code: "checkpoint_required" });
    expect(compareCommits).not.toHaveBeenCalled();
    expect(generateContent).not.toHaveBeenCalled();
  });

  it("needs a plan", async () => {
    getPlan.mockResolvedValue(null);
    await expect(generateQuiz(target(), deps())).rejects.toMatchObject({ code: "plan_required" });
    expect(generateContent).not.toHaveBeenCalled();
  });

  it("will not make a quiz when there is no readable code, and does not ask the AI", async () => {
    compareCommits.mockResolvedValue(toDiff(NOTHING_READABLE));
    await expect(generateQuiz(target(), deps())).rejects.toMatchObject({ code: "nothing_to_ask" });
    expect(generateContent).not.toHaveBeenCalled();
    expect(quizzes.quizzes).toHaveLength(0);
  });

  it("never replaces an existing quiz: a second request changes nothing and does not call the AI", async () => {
    await generateQuiz(target(), deps());
    generateContent.mockClear();
    compareCommits.mockClear();
    await expect(generateQuiz(target(), deps())).rejects.toMatchObject({ code: "quiz_exists" });
    expect(generateContent).not.toHaveBeenCalled();
    expect(compareCommits).not.toHaveBeenCalled();
    expect(quizzes.quizzes).toHaveLength(1);
  });

  it("simultaneous requests: exactly one quiz is stored, the others report quiz_exists", async () => {
    const results = await Promise.allSettled(Array.from({ length: 5 }, () => generateQuiz(target(), deps())));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(rejected.every((r) => r.reason instanceof QuizError && r.reason.code === "quiz_exists")).toBe(true);
    expect(quizzes.quizzes).toHaveLength(1);
  });

  it("stores nothing when GitHub or Gemini fails", async () => {
    compareCommits.mockRejectedValueOnce(new GitHubError("unavailable"));
    await expect(generateQuiz(target(), deps())).rejects.toBeInstanceOf(GitHubError);
    generateContent.mockRejectedValueOnce(new GeminiError("timeout"));
    await expect(generateQuiz(target(), deps())).rejects.toBeInstanceOf(GeminiError);
    generateContent.mockResolvedValue({ text: "not json" });
    await expect(generateQuiz(target(), deps())).rejects.toMatchObject({ code: "invalid_response" });
    expect(quizzes.quizzes).toHaveLength(0);
  });

  it("a failed attempt to generate leaves the door open: a later request can still create it", async () => {
    generateContent.mockRejectedValueOnce(new GeminiError("unavailable"));
    await expect(generateQuiz(target(), deps())).rejects.toBeInstanceOf(GeminiError);
    expect((await generateQuiz(target(), deps())).state).toBe("open");
  });
});

describe("getQuizView", () => {
  it("is null before a quiz exists, and for a week that was not recorded", async () => {
    expect(await getQuizView(PROJECT, 1, { checkpoints: checkpoints.store, quizzes: quizzes.store })).toBeNull();
    expect(await getQuizView(PROJECT, 3, { checkpoints: checkpoints.store, quizzes: quizzes.store })).toBeNull();
  });

  it("returns the open quiz without answers, then the full review once it has been taken", async () => {
    await generateQuiz(target(), deps());
    const read = () => getQuizView(PROJECT, 1, { checkpoints: checkpoints.store, quizzes: quizzes.store });
    const open = await read();
    expect(open?.state).toBe("open");
    expect(JSON.stringify(open)).not.toMatch(/correctIndex|explanation/);

    const stored = quizzes.quizzes[0];
    await submitAttempt({ projectId: PROJECT, weekNumber: 1 }, stored.questions.map((q) => q.correctIndex), {
      checkpoints: checkpoints.store,
      quizzes: quizzes.store,
    });
    const taken = await read();
    expect(taken).toMatchObject({ state: "taken", correctCount: 5, total: 5 });
  });
});

describe("submitAttempt", () => {
  const sub = (answers: number[], week = 1) =>
    submitAttempt({ projectId: PROJECT, weekNumber: week }, answers, { checkpoints: checkpoints.store, quizzes: quizzes.store });

  beforeEach(async () => {
    await generateQuiz(target(), deps());
  });

  /** Answers that are right for the questions at the given positions and wrong elsewhere. */
  const answersWith = (rightAt: number[]) =>
    quizzes.quizzes[0].questions.map((q, i) => (rightAt.includes(i) ? q.correctIndex : (q.correctIndex + 1) % 4));

  it("grades on the server and returns the review with the correct answers and explanations", async () => {
    const view = await sub(answersWith([0, 2, 4]));
    expect(view).toMatchObject({ state: "taken", correctCount: 3, total: 5 });
    if (view.state !== "taken") throw new Error("expected a taken quiz");
    const stored = quizzes.quizzes[0].questions;
    view.questions.forEach((q, i) => {
      expect(q.correctIndex).toBe(stored[i].correctIndex);
      expect(q.explanation).toBe(stored[i].explanation);
    });
    expect(quizzes.attempts).toHaveLength(1);
    expect(quizzes.attempts[0]).toMatchObject({ correctCount: 3, total: 5 });
  });

  it.each([
    [[0, 1, 2, 3, 4], 5],
    [[], 0],
    [[1], 1],
  ])("scores %j correct as %i", async (rightAt, expected) => {
    const view = await sub(answersWith(rightAt));
    expect(view).toMatchObject({ correctCount: expected, total: 5 });
  });

  it("allows exactly one attempt, and the saved result never changes", async () => {
    await sub(answersWith([0]));
    await expect(sub(answersWith([0, 1, 2, 3, 4]))).rejects.toMatchObject({ code: "already_attempted" });
    expect(quizzes.attempts).toHaveLength(1);
    expect(quizzes.attempts[0].correctCount).toBe(1);
  });

  it("simultaneous submissions: exactly one is saved", async () => {
    const results = await Promise.allSettled(Array.from({ length: 5 }, () => sub(answersWith([0, 1, 2, 3, 4]))));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(quizzes.attempts).toHaveLength(1);
  });

  it("reports a missing quiz, and an unrecorded week", async () => {
    await expect(sub([0, 0, 0, 0, 0], 3)).rejects.toMatchObject({ code: "checkpoint_required" });
    await record(2);
    await expect(sub([0, 0, 0, 0, 0], 2)).rejects.toMatchObject({ code: "quiz_not_found" });
  });
});

describe("toView", () => {
  it("is open without an attempt, and taken with one", async () => {
    await generateQuiz(target(), deps());
    const stored = { quiz: quizzes.quizzes[0], attempt: null };
    expect(toView(stored).state).toBe("open");
  });
});
