import { beforeEach, describe, expect, it, vi } from "vitest";
import { GitHubError } from "@/lib/github/errors";

const state = vi.hoisted(() => ({
  duration: 12,
  head: "" as string | Error,
  compare: undefined as unknown,
  db: undefined as unknown as { store: unknown; baselines: Map<string, unknown>; checkpoints: unknown[] },
}));

vi.mock("@/lib/projects/repository", () => ({
  getProject: vi.fn(async () => ({ id: "x", repoUrl: "https://github.com/octocat/hello-world", durationWeeks: state.duration })),
}));
vi.mock("@/lib/checkpoints/repository", async () => {
  const { memoryStore } = await import("@/test/memory-checkpoint-store");
  state.db = memoryStore();
  return { checkpointStore: state.db.store };
});
vi.mock("@/lib/evaluation/repository", () => ({ evaluationStore: { listStatuses: async () => [] } }));
vi.mock("@/lib/github/client", () => ({
  getGitHubClient: () => ({
    getRepository: async () => ({ default_branch: "main" }),
    getHeadCommit: async () => {
      if (state.head instanceof Error) throw state.head;
      return { sha: state.head };
    },
    compareCommits: async () =>
      state.compare ?? { status: "ahead", isEmpty: false, totalFiles: 3, totalAdditions: 10, totalDeletions: 2 },
  }),
}));
vi.mock("@/lib/db/supabase", () => ({ StorageConfigError: class extends Error {} }));

import { POST as postBaseline } from "../../../baseline/route";
import { GET as getProgress } from "../../../progress/route";
import { POST } from "./route";

const id = "123e4567-e89b-42d3-a456-426614174000";
const sha = (c: string) => c.repeat(40);
const req = new Request("http://localhost/x", { method: "POST" });
const week = (n: string, projectId = id) => ({ params: Promise.resolve({ id: projectId, week: n }) }) as never;
const project = (projectId = id) => ({ params: Promise.resolve({ id: projectId }) }) as never;

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  state.duration = 12;
  state.db.baselines.clear();
  state.db.checkpoints.length = 0;
  state.head = sha("0");
  state.compare = undefined;
});

async function startProject() {
  state.head = sha("0");
  expect((await postBaseline(req, project())).status).toBe(201);
}

describe("POST /api/projects/[id]/baseline", () => {
  it("records the starting point once", async () => {
    const res = await postBaseline(req, project());
    expect(res.status).toBe(201);
    expect((await res.json()).baseline).toMatchObject({ commitSha: sha("0"), branch: "main" });
    const again = await postBaseline(req, project());
    expect(again.status).toBe(409);
    expect((await again.json()).error.code).toBe("baseline_exists");
  });

  it("explains an empty repository", async () => {
    state.head = new GitHubError("empty_repository");
    const res = await postBaseline(req, project());
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("github_empty_repository");
  });

  it("rejects a bad project id without side effects", async () => {
    expect((await postBaseline(req, project("nope"))).status).toBe(400);
    expect(state.db.baselines.size).toBe(0);
  });
});

describe("POST /api/projects/[id]/weeks/[week]/complete", () => {
  it("records the checkpoint (201)", async () => {
    await startProject();
    state.head = sha("1");
    const res = await POST(req, week("1"));
    expect(res.status).toBe(201);
    expect((await res.json()).checkpoint).toMatchObject({
      weekNumber: 1,
      commitSha: sha("1"),
      baseCommitSha: sha("0"),
      filesChanged: 3,
      additions: 10,
      deletions: 2,
    });
  });

  it.each(["0", "13", "abc", "1.5", "-1", "01x", "100", ""])("rejects week %j with 400", async (value) => {
    await startProject();
    expect((await POST(req, week(value))).status).toBe(400);
    expect(state.db.checkpoints).toHaveLength(0);
  });

  it("the project's own duration limits the weeks: a 3-week project refuses week 4 and says why", async () => {
    state.duration = 3;
    await startProject();
    state.head = sha("1");
    const res = await POST(req, week("4"));
    expect(res.status).toBe(400);
    const { error } = await res.json();
    expect(error.code).toBe("invalid_week");
    expect(error.message).toMatch(/lasts 3 weeks.*1 to 3/);
    expect(state.db.checkpoints).toHaveLength(0);
    expect((await POST(req, week("1"))).status).toBe(201); // week 1 of a 3-week project is fine
  });

  it("a longer project allows later weeks (week 13 of 16 is only blocked by the earlier weeks)", async () => {
    state.duration = 16;
    await startProject();
    state.head = sha("1");
    const res = await POST(req, week("13"));
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("previous_week_required");
  });

  it("409 baseline_required before a starting point exists", async () => {
    state.head = sha("1");
    const res = await POST(req, week("1"));
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("baseline_required");
  });

  it("409 previous_week_required when skipping ahead", async () => {
    await startProject();
    state.head = sha("1");
    const res = await POST(req, week("2"));
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("previous_week_required");
  });

  it("409 no_new_commits and 409 empty_diff, each with a clear message", async () => {
    await startProject();
    let res = await POST(req, week("1")); // head still equals the baseline
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("no_new_commits");

    state.head = sha("1");
    state.compare = { status: "ahead", isEmpty: true, totalFiles: 0, totalAdditions: 0, totalDeletions: 0 };
    res = await POST(req, week("1"));
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("empty_diff");
    expect(state.db.checkpoints).toHaveLength(0);
  });

  it("repeated clicks: first 201, the rest 409 already_recorded carrying the original", async () => {
    await startProject();
    state.head = sha("1");
    expect((await POST(req, week("1"))).status).toBe(201);

    state.head = sha("2"); // more work pushed afterwards must not replace it
    const again = await POST(req, week("1"));
    expect(again.status).toBe(409);
    const body = await again.json();
    expect(body.error.code).toBe("already_recorded");
    expect(body.checkpoint.commitSha).toBe(sha("1"));
    expect(state.db.checkpoints).toHaveLength(1);
  });

  it("simultaneous clicks record exactly once", async () => {
    await startProject();
    state.head = sha("1");
    const responses = await Promise.all(Array.from({ length: 6 }, () => POST(req, week("1"))));
    const statuses = responses.map((r) => r.status).sort();
    expect(statuses).toEqual([201, 409, 409, 409, 409, 409]);
    expect(state.db.checkpoints).toHaveLength(1);
  });

  it.each([
    ["not_found", 404],
    ["rate_limited", 429],
    ["empty_repository", 409],
  ] as const)("maps GitHub %s to HTTP %i and records nothing", async (githubCode, status) => {
    await startProject();
    state.head = new GitHubError(githubCode);
    const res = await POST(req, week("1"));
    expect(res.status).toBe(status);
    expect(state.db.checkpoints).toHaveLength(0);
  });
});

describe("GET /api/projects/[id]/progress", () => {
  it("returns the baseline and checkpoints, and distinguishes them from evaluations", async () => {
    expect(await (await getProgress(new Request("http://localhost/x"), project())).json()).toEqual({
      baseline: null,
      checkpoints: [],
      evaluations: [],
    });
    await startProject();
    state.head = sha("1");
    await POST(req, week("1"));
    const body = await (await getProgress(new Request("http://localhost/x"), project())).json();
    expect(body.baseline.commitSha).toBe(sha("0"));
    expect(body.checkpoints).toHaveLength(1);
    expect(body.evaluations).toEqual([]); // statuses only
    expect(JSON.stringify(body)).not.toMatch(/score|approved|suggested/i);
  });
});
