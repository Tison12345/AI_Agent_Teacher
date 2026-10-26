// End-to-end workflow: student creates a project and submits weeks, the AI evaluates,
// a teacher decides, the student sees the official result. The real route handlers run
// against in-memory stores; only GitHub, Gemini and the database are replaced.
import { ApiError } from "@google/genai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GitHubError } from "@/lib/github/errors";
import { memoryStore } from "@/test/memory-checkpoint-store";
import { memoryEvaluationStore } from "@/test/memory-evaluation-store";
import { memoryReviewStore } from "@/test/memory-review-store";
import { memoryQuizStore } from "@/test/memory-quiz-store";
import { modelQuiz } from "@/lib/quiz/fixtures";
import type { Project } from "@/lib/schemas/project";
import type { StoredPlan, WeeklyPlanItem } from "@/lib/schemas/weekly-plan";

const REPO_URL = "https://github.com/octocat/hello-world";
const sha = (c: string) => c.repeat(40);

const state = vi.hoisted(() => ({
  head: "",
  githubError: null as Error | null,
  geminiScript: [] as Array<{ text?: string } | Error>,
  geminiCalls: [] as Array<{ contents: string }>,
  projects: [] as unknown[],
  plans: new Map<string, unknown>(),
  checkpoints: undefined as unknown,
  evaluations: undefined as unknown,
  review: undefined as unknown,
  quizzes: undefined as unknown,
}));

vi.mock("@/lib/db/supabase", () => ({ StorageConfigError: class extends Error {} }));
vi.mock("@/lib/projects/repository", () => ({
  RepositoryError: class RepositoryError extends Error {
    constructor(
      readonly code: string,
      message: string,
    ) {
      super(message);
    }
  },
  createProject: async (input: { title: string; description: string; repoUrl: string; durationWeeks: 12 }) => {
    const project = {
      ...input,
      id: `00000000-0000-4000-8000-${String(state.projects.length + 1).padStart(12, "0")}`,
      createdAt: "2026-10-26T09:00:00+00:00",
    };
    state.projects.push(project);
    return project;
  },
  listProjects: async () => [...state.projects],
  getProject: async (id: string) => (state.projects as Project[]).find((p) => p.id === id) ?? null,
}));
vi.mock("@/lib/plans/repository", () => ({
  getPlan: async (id: string) => state.plans.get(id) ?? null,
  savePlan: async (id: string, plan: WeeklyPlanItem[], model: string) => {
    const stored: StoredPlan = { projectId: id, plan, model, generatedAt: "2026-10-26T09:05:00+00:00" };
    state.plans.set(id, stored);
    return stored;
  },
}));
vi.mock("@/lib/checkpoints/repository", async () => {
  state.checkpoints = memoryStore();
  return { checkpointStore: (state.checkpoints as ReturnType<typeof memoryStore>).store };
});
vi.mock("@/lib/evaluation/repository", async () => {
  state.evaluations = memoryEvaluationStore();
  return { evaluationStore: (state.evaluations as ReturnType<typeof memoryEvaluationStore>).store };
});
vi.mock("@/lib/quiz/repository", async () => {
  state.quizzes = memoryQuizStore();
  return { quizStore: (state.quizzes as ReturnType<typeof memoryQuizStore>).store };
});
vi.mock("@/lib/review/repository", async () => {
  const world = state.evaluations as ReturnType<typeof memoryEvaluationStore>;
  // Make sure the quiz store exists first: the queue shows each week's quiz summary.
  await import("@/lib/quiz/repository");
  state.review = memoryReviewStore(world.rows, [], state.quizzes as ReturnType<typeof memoryQuizStore>);
  return { reviewStore: (state.review as ReturnType<typeof memoryReviewStore>).store };
});
vi.mock("@/lib/gemini/client", () => ({
  getGeminiModel: () => "test-model",
  getGeminiClient: () => ({
    models: {
      generateContent: async (request: { contents: string }) => {
        state.geminiCalls.push({ contents: request.contents });
        const next = state.geminiScript.shift();
        if (!next) throw new Error("unexpected Gemini call");
        if (next instanceof Error) throw next;
        return next;
      },
    },
  }),
}));
vi.mock("@/lib/github/client", () => ({
  getGitHubClient: () => ({
    getRepository: async () => ({ default_branch: "main" }),
    getHeadCommit: async () => {
      if (state.githubError) throw state.githubError;
      return { sha: state.head, branch: "main", message: "m", date: null };
    },
    compareCommits: async (_o: string, _r: string, base: string, head: string) => {
      if (state.githubError) throw state.githubError;
      return {
        status: "ahead",
        aheadBy: 2,
        behindBy: 0,
        totalCommits: 2,
        baseSha: base,
        headSha: head,
        isEmpty: false,
        files: [
          { path: "src/app.js", status: "added", additions: 12, deletions: 0, patch: "@@ -0,0 +1,2 @@\n+function addBook() {}\n+addBook();", patchTruncated: false },
        ],
        totalFiles: 1,
        totalAdditions: 12,
        totalDeletions: 0,
        filesOmitted: 0,
        patchChars: 40,
        truncated: false,
      };
    },
  }),
}));

import { POST as createProject, GET as listProjects } from "@/app/api/projects/route";
import { POST as generatePlan } from "@/app/api/projects/[id]/plan/route";
import { POST as recordBaseline } from "@/app/api/projects/[id]/baseline/route";
import { POST as completeWeek } from "@/app/api/projects/[id]/weeks/[week]/complete/route";
import { POST as evaluate } from "@/app/api/projects/[id]/weeks/[week]/evaluate/route";
import { GET as getProgress } from "@/app/api/projects/[id]/progress/route";
import { GET as getResults } from "@/app/api/projects/[id]/results/route";
import { GET as getQueue } from "@/app/api/faculty/evaluations/route";
import { GET as getReview } from "@/app/api/faculty/evaluations/[id]/route";
import { POST as decide } from "@/app/api/faculty/evaluations/[id]/decision/route";
import { GET as getQuiz, POST as createQuiz } from "@/app/api/projects/[id]/weeks/[week]/quiz/route";
import { POST as attemptQuiz } from "@/app/api/projects/[id]/weeks/[week]/quiz/attempt/route";
import { GET as getReviewQuiz } from "@/app/api/faculty/evaluations/[id]/quiz/route";

const week = (n: number): WeeklyPlanItem => ({
  weekNumber: n,
  title: `Week ${n}`,
  objectives: ["Build the first working version of one feature."],
  tasks: ["Pick one feature to start with.", "Build a simple version of it."],
  deliverables: ["A feature that works in a simple way."],
  evaluationCriteria: [
    { name: "Works", description: "The feature runs.", maxPoints: 60 },
    { name: "Quality", description: "The code is easy to read.", maxPoints: 40 },
  ],
});
const plan = (weeks = 12) => ({ text: JSON.stringify(Array.from({ length: weeks }, (_, i) => week(i + 1))) });

/** What the model returns for an evaluation of the plan above. Total: 50 + 30 of 100 = 80. */
const evaluation = (over: Record<string, unknown> = {}) => ({
  text: JSON.stringify({
    criteria: [
      { name: "Works", score: 50, rationale: "A feature is present.", evidence: [{ filePath: "src/app.js", observation: "addBook is defined and called." }] },
      { name: "Quality", score: 30, rationale: "Readable so far.", evidence: [{ filePath: "src/app.js", observation: "The code is short and clear." }] },
    ],
    completedRequirements: ["A first feature exists"],
    incompleteRequirements: [],
    technicalConcerns: [],
    feedbackForNextWeek: ["Add a way to remove a book."],
    confidence: { level: "high", uncertainties: [] },
    ...over,
  }),
});

const json = (body?: unknown) => ({ method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });
const req = (init: RequestInit = { method: "GET" }) => new Request("http://localhost/x", init);
const proj = (id: string) => ({ params: Promise.resolve({ id }) }) as never;
const weekCtx = (id: string, w: number) => ({ params: Promise.resolve({ id, week: String(w) }) }) as never;

async function body(res: Response) {
  return (await res.json()) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
}

async function createStudentProject(durationWeeks?: number): Promise<string> {
  const res = await createProject(
    req({
      method: "POST",
      body: JSON.stringify({ title: "Library app", description: "A small app to keep track of books I read.", repoUrl: REPO_URL, durationWeeks }),
    }),
  );
  expect(res.status).toBe(201);
  return (await body(res)).project.id;
}

/** Create, plan and baseline: the project is ready for Week 1. */
async function startProject(durationWeeks?: number): Promise<string> {
  const id = await createStudentProject(durationWeeks);
  state.geminiScript.push(plan(durationWeeks));
  expect((await generatePlan(req(json()), proj(id))).status).toBe(201);
  state.head = sha("0");
  expect((await recordBaseline(req(json()), proj(id))).status).toBe(201);
  return id;
}

async function submitWeek(id: string, n: number, head: string) {
  state.head = head;
  return completeWeek(req(json()), weekCtx(id, n));
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  state.head = "";
  state.githubError = null;
  state.geminiScript = [];
  state.geminiCalls = [];
  state.projects = [];
  state.plans.clear();
  const checkpoints = state.checkpoints as ReturnType<typeof memoryStore>;
  checkpoints.checkpoints.length = 0;
  checkpoints.baselines.clear();
  (state.evaluations as ReturnType<typeof memoryEvaluationStore>).rows.length = 0;
  (state.review as ReturnType<typeof memoryReviewStore>).decisions.length = 0;
  const quizzes = state.quizzes as ReturnType<typeof memoryQuizStore>;
  quizzes.quizzes.length = 0;
  quizzes.attempts.length = 0;
});

describe("student to teacher workflow", () => {
  it("project → plan → starting point → week 1 → AI evaluation → teacher edit → student sees the official result", async () => {
    const id = await startProject();
    expect((await body(await listProjects())).projects).toHaveLength(1);

    // The student submits Week 1 and the evaluation is requested.
    const recorded = await submitWeek(id, 1, sha("1"));
    expect(recorded.status).toBe(201);
    state.geminiScript.push(evaluation());
    const evaluated = await evaluate(req(json()), weekCtx(id, 1));
    expect(evaluated.status).toBe(201);
    const evaluatedBody = await body(evaluated);
    expect(evaluatedBody.evaluation.status).toBe("pending_review");
    expect(JSON.stringify(evaluatedBody)).not.toMatch(/score|suggested|80/i); // the student is not told the AI's number

    // The student's own view: status only, and no official result yet.
    const progress = await body(await getProgress(req(), proj(id)));
    expect(progress.evaluations).toEqual([{ weekNumber: 1, status: "pending_review" }]);
    expect(JSON.stringify(progress)).not.toMatch(/score|suggested|approved/i);
    expect(await body(await getResults(req(), proj(id)))).toEqual({ results: [] });

    // The teacher finds it in the queue, with the AI's recommendation.
    const queue = (await body(await getQueue(req()))).evaluations;
    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({ weekNumber: 1, status: "pending_review", suggestedScore: 80, officialScore: null });
    const evaluationId = queue[0].evaluationId;
    const detail = await body(await getReview(req(), proj(evaluationId)));
    expect(detail.evaluation.suggestedScore).toBe(80);
    expect(detail.snapshot.files[0].patch).toContain("addBook");
    expect(detail.decision).toBeNull();

    // The teacher edits: a different official score, their own feedback, a private comment.
    const decided = await decide(
      req(json({ decision: "edit", approvedScore: 65, approvedFeedback: "Good start. Add a remove button.", comment: "PRIVATE-REASON" })),
      proj(evaluationId),
    );
    expect(decided.status).toBe(201);

    // The decision is final.
    const again = await decide(req(json({ decision: "approve" })), proj(evaluationId));
    expect(again.status).toBe(409);

    // The student now sees the official result and nothing from the AI or the private comment.
    const results = await body(await getResults(req(), proj(id)));
    expect(results.results).toEqual([
      { weekNumber: 1, outcome: "edited", officialScore: 65, feedback: "Good start. Add a remove button.", decidedAt: expect.any(String) },
    ]);
    expect(JSON.stringify(results)).not.toMatch(/PRIVATE|\b80\b|suggested|confidence|criteri/i);
    expect((await body(await getProgress(req(), proj(id)))).evaluations).toEqual([{ weekNumber: 1, status: "edited" }]);

    // The teacher's lists now tell the AI's number and the official one apart.
    expect((await body(await getQueue(req()))).evaluations).toEqual([]);
    const history = (await body(await getQueue(new Request("http://localhost/api/faculty/evaluations?status=edited")))).evaluations;
    expect(history[0]).toMatchObject({ suggestedScore: 80, officialScore: 65, status: "edited" });
  });

  it("weekly quiz: made from the recorded week, answers withheld until the one attempt, shown to the teacher as separate evidence", async () => {
    const id = await startProject();
    await submitWeek(id, 1, sha("1"));
    state.geminiScript.push(evaluation());
    expect((await evaluate(req(json()), weekCtx(id, 1))).status).toBe(201);

    // No quiz exists until the student asks for one; the quiz is made from the code changes.
    expect(await body(await getQuiz(req(), weekCtx(id, 1)))).toEqual({ quiz: null });
    state.geminiScript.push({ text: JSON.stringify(modelQuiz()) });
    const created = await createQuiz(req(json()), weekCtx(id, 1));
    expect(created.status).toBe(201);
    const createdText = JSON.stringify(await body(created));
    expect(createdText).not.toMatch(/correctIndex|explanation/);
    expect(state.geminiCalls.at(-1)!.contents).toContain("addBook");
    expect((await createQuiz(req(json()), weekCtx(id, 1))).status).toBe(409); // one quiz per week

    // The teacher sees that the quiz exists but has not been taken, with no answers.
    const queueBefore = (await body(await getQueue(req()))).evaluations;
    expect(queueBefore[0].quiz).toEqual({ status: "not_taken", correctCount: null, total: null });
    const evaluationId = queueBefore[0].evaluationId;
    const before = await getReviewQuiz(req(), proj(evaluationId));
    expect((await body(before)).quiz.state).toBe("open");

    // The student answers: three right, two wrong. The server grades it.
    const stored = (state.quizzes as ReturnType<typeof memoryQuizStore>).quizzes[0].questions;
    const answers = stored.map((q, i) => (i < 3 ? q.correctIndex : (q.correctIndex + 1) % 4));
    const attempted = await attemptQuiz(req(json({ answers })), weekCtx(id, 1));
    expect(attempted.status).toBe(201);
    expect((await body(attempted)).quiz).toMatchObject({ state: "taken", correctCount: 3, total: 5 });
    expect((await attemptQuiz(req(json({ answers })), weekCtx(id, 1))).status).toBe(409); // one attempt

    // The teacher now sees the result next to the AI recommendation, which has not changed.
    expect((await body(await getQueue(req()))).evaluations[0].quiz).toEqual({ status: "taken", correctCount: 3, total: 5 });
    expect((await body(await getReviewQuiz(req(), proj(evaluationId)))).quiz).toMatchObject({ state: "taken", correctCount: 3 });
    const detail = await body(await getReview(req(), proj(evaluationId)));
    expect(detail.evaluation.suggestedScore).toBe(80);
    expect(detail.evaluation.status).toBe("pending_review");

    // The quiz never becomes a mark: the student's official results are still empty.
    expect(await body(await getResults(req(), proj(id)))).toEqual({ results: [] });
  });

  it("week 2 builds on week 1: it is compared with week 1's commit and the AI is told what was open", async () => {
    const id = await startProject();
    await submitWeek(id, 1, sha("1"));
    state.geminiScript.push(evaluation({ incompleteRequirements: ["Removing a book"] }));
    expect((await evaluate(req(json()), weekCtx(id, 1))).status).toBe(201);

    // Skipping ahead is not allowed.
    expect((await submitWeek(id, 3, sha("2"))).status).toBe(409);

    expect((await submitWeek(id, 2, sha("2"))).status).toBe(201);
    const week2 = (await body(await getProgress(req(), proj(id)))).checkpoints.find((c: { weekNumber: number }) => c.weekNumber === 2);
    expect(week2).toMatchObject({ commitSha: sha("2"), baseCommitSha: sha("1") });
    state.geminiScript.push(evaluation());
    expect((await evaluate(req(json()), weekCtx(id, 2))).status).toBe(201);
    const prompt = state.geminiCalls.at(-1)!.contents;
    expect(prompt).toContain("previousWeek");
    expect(prompt).toContain("Removing a book");
  });

  it("a rejected evaluation gives the student no score at all", async () => {
    const id = await startProject();
    await submitWeek(id, 1, sha("1"));
    state.geminiScript.push(evaluation());
    await evaluate(req(json()), weekCtx(id, 1));
    const evaluationId = (await body(await getQueue(req()))).evaluations[0].evaluationId;
    expect((await decide(req(json({ decision: "reject", comment: "The AI could not see the main files." })), proj(evaluationId))).status).toBe(201);
    const results = await body(await getResults(req(), proj(id)));
    expect(results.results).toEqual([
      { weekNumber: 1, outcome: "rejected", officialScore: null, feedback: null, decidedAt: expect.any(String) },
    ]);
  });
});

describe("projects of different lengths", () => {
  it("a 3-week project gets a 3-week plan, accepts weeks 1 to 3 and refuses week 4", async () => {
    const id = await startProject(3);
    const stored = (await body(await (await import("@/app/api/projects/[id]/plan/route")).GET(req(), proj(id)))).plan;
    expect(stored.plan).toHaveLength(3);
    expect((await body(await getProgress(req(), proj(id)))).checkpoints).toEqual([]);

    expect((await submitWeek(id, 1, sha("1"))).status).toBe(201);
    expect((await submitWeek(id, 2, sha("2"))).status).toBe(201);
    expect((await submitWeek(id, 3, sha("3"))).status).toBe(201);
    const beyond = await submitWeek(id, 4, sha("4"));
    expect(beyond.status).toBe(400);
    expect((await body(beyond)).error.message).toMatch(/lasts 3 weeks/);
    expect((await body(await getProgress(req(), proj(id)))).checkpoints).toHaveLength(3);
  });

  it("the project list reports each project's own length", async () => {
    await createStudentProject(4);
    await createStudentProject();
    const weeks = (await body(await listProjects())).projects.map((p: { durationWeeks: number }) => p.durationWeeks);
    expect(weeks).toEqual([4, 12]);
  });

  it.each([0, 17, "4", null])("refuses to create a project with a duration of %j", async (durationWeeks) => {
    const res = await createProject(
      req({ method: "POST", body: JSON.stringify({ title: "Library app", description: "A small app to keep track of books I read.", repoUrl: REPO_URL, durationWeeks }) }),
    );
    expect(res.status).toBe(400);
    expect((await body(await listProjects())).projects).toHaveLength(0);
  });
});

describe("failures across GitHub and Gemini", () => {
  async function weekOneRecorded() {
    const id = await startProject();
    expect((await submitWeek(id, 1, sha("1"))).status).toBe(201);
    return id;
  }
  const evaluationRows = () => (state.evaluations as ReturnType<typeof memoryEvaluationStore>).rows;

  it("Gemini unavailable: the week stays recorded, nothing is stored, and a retry works", async () => {
    const id = await weekOneRecorded();
    state.geminiScript.push(new ApiError({ message: "overloaded", status: 503 }));
    const failed = await evaluate(req(json()), weekCtx(id, 1));
    expect(failed.status).toBe(502);
    expect((await body(failed)).error.code).toBe("gemini_unavailable");
    expect(evaluationRows()).toHaveLength(0);
    expect((await body(await getProgress(req(), proj(id)))).checkpoints).toHaveLength(1);

    state.geminiScript.push(evaluation());
    expect((await evaluate(req(json()), weekCtx(id, 1))).status).toBe(201);
    expect(evaluationRows()).toHaveLength(1);
  });

  it("Gemini daily quota: a clear message that does not say to wait a minute", async () => {
    const id = await weekOneRecorded();
    state.geminiScript.push(new ApiError({ message: "Quota exceeded: GenerateRequestsPerDayPerProjectPerModel-FreeTier", status: 429 }));
    const res = await evaluate(req(json()), weekCtx(id, 1));
    expect(res.status).toBe(429);
    const error = (await body(res)).error;
    expect(error.code).toBe("gemini_quota_exhausted");
    expect(error.message).toMatch(/tomorrow/);
    expect(error.message).not.toMatch(/minute/);
    expect(evaluationRows()).toHaveLength(0);
  });

  it("Gemini answers that claim the code was run are rejected twice and never stored", async () => {
    const id = await weekOneRecorded();
    const bad = evaluation({
      criteria: [
        { name: "Works", score: 60, rationale: "I ran the app and every test passes.", evidence: [{ filePath: "src/app.js", observation: "Works." }] },
        { name: "Quality", score: 40, rationale: "Great.", evidence: [{ filePath: "src/app.js", observation: "Clean." }] },
      ],
    });
    state.geminiScript.push(bad, bad);
    const res = await evaluate(req(json()), weekCtx(id, 1));
    expect(res.status).toBe(502);
    expect((await body(res)).error.code).toBe("gemini_invalid_response");
    expect(evaluationRows()).toHaveLength(0);
  });

  it("GitHub rate limit while submitting a week: nothing is recorded and the message says when it resets", async () => {
    await startProject();
    const id = (state.projects[0] as Project).id;
    state.githubError = new GitHubError("rate_limited", { resetAt: "2026-10-26T20:58:00.000Z" });
    const res = await submitWeek(id, 1, sha("1"));
    expect(res.status).toBe(429);
    expect((await body(res)).error.message).toContain("20:58 UTC");
    expect((await body(await getProgress(req(), proj(id)))).checkpoints).toEqual([]);
  });

  it("GitHub failing during evaluation: reported, nothing stored, Gemini never called", async () => {
    const id = await weekOneRecorded();
    state.githubError = new GitHubError("unavailable");
    const res = await evaluate(req(json()), weekCtx(id, 1));
    expect(res.status).toBe(502);
    expect(state.geminiCalls.filter((c) => c.contents.includes("<review_input>"))).toHaveLength(0);
    expect(evaluationRows()).toHaveLength(0);
  });

  it("evaluating a week that was never submitted, or twice, changes nothing", async () => {
    const id = await startProject();
    expect((await evaluate(req(json()), weekCtx(id, 1))).status).toBe(409);
    await submitWeek(id, 1, sha("1"));
    state.geminiScript.push(evaluation());
    expect((await evaluate(req(json()), weekCtx(id, 1))).status).toBe(201);
    const second = await evaluate(req(json()), weekCtx(id, 1));
    expect(second.status).toBe(409);
    expect(JSON.stringify(await body(second))).not.toMatch(/suggested|80/);
    expect(state.geminiCalls.filter((c) => c.contents.includes("<review_input>"))).toHaveLength(1);
  });

  it("malformed ids, unknown projects and out-of-range weeks fail early with specific errors", async () => {
    const id = await weekOneRecorded();
    expect((await evaluate(req(json()), weekCtx("nope", 1))).status).toBe(400);
    expect((await evaluate(req(json()), weekCtx("00000000-0000-4000-8000-0000000000ff", 1))).status).toBe(404);
    expect((await evaluate(req(json()), weekCtx(id, 13))).status).toBe(400);
  });
});
