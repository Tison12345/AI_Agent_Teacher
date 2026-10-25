import { beforeEach, describe, expect, it, vi } from "vitest";
import { GitHubError } from "@/lib/github/errors";
import { memoryStore } from "@/test/memory-checkpoint-store";
import {
  CheckpointError,
  StoreConflictError,
  completeWeek,
  getProgress,
  recordBaseline,
  type CheckpointStore,
  type GitHubReader,
} from "./service";

const PROJECT = "123e4567-e89b-42d3-a456-426614174000";
const sha = (c: string) => c.repeat(40);
const S0 = sha("0"); // initial commit = baseline
const S1 = sha("1");
const S2 = sha("2");
const S3 = sha("3");
const target = { projectId: PROJECT, owner: "octocat", repo: "hello-world", durationWeeks: 12 };

type Compare = Awaited<ReturnType<GitHubReader["compareCommits"]>>;
const changed = (over: Partial<Compare> = {}): Compare => ({
  status: "ahead",
  isEmpty: false,
  totalFiles: 4,
  totalAdditions: 120,
  totalDeletions: 30,
  ...over,
});

/** Fake GitHub whose head commit and compare result are set per test. */
function fakeGitHub(state: { head: string | Error; compare?: Compare | Error; branch?: string }) {
  const github = {
    getRepository: vi.fn(async () => ({ default_branch: state.branch ?? "main" })),
    getHeadCommit: vi.fn(async () => {
      if (state.head instanceof Error) throw state.head;
      return { sha: state.head };
    }),
    compareCommits: vi.fn(async () => {
      const result = state.compare ?? changed();
      if (result instanceof Error) throw result;
      return result;
    }),
  } satisfies GitHubReader;
  return github;
}

let db: ReturnType<typeof memoryStore>;
beforeEach(() => {
  db = memoryStore();
});

const code = (promise: Promise<unknown>) =>
  promise.then(
    () => "no error",
    (e: unknown) => (e instanceof CheckpointError ? e.code : e instanceof GitHubError ? `github:${e.code}` : "other"),
  );

describe("recordBaseline", () => {
  it("records the default branch's latest commit", async () => {
    const github = fakeGitHub({ head: S0, branch: "trunk" });
    const baseline = await recordBaseline(target, { store: db.store, github });
    expect(baseline).toMatchObject({ projectId: PROJECT, commitSha: S0, branch: "trunk" });
    expect(github.getHeadCommit).toHaveBeenCalledWith("octocat", "hello-world", "trunk");
  });

  it("cannot be recorded twice, and the original is never replaced", async () => {
    await recordBaseline(target, { store: db.store, github: fakeGitHub({ head: S0 }) });
    const second = recordBaseline(target, { store: db.store, github: fakeGitHub({ head: S3 }) });
    expect(await code(second)).toBe("baseline_exists");
    expect(db.baselines.get(PROJECT)?.commitSha).toBe(S0);
  });

  it("two simultaneous clicks record exactly one baseline", async () => {
    const github = fakeGitHub({ head: S0 });
    const results = await Promise.allSettled([
      recordBaseline(target, { store: db.store, github }),
      recordBaseline(target, { store: db.store, github }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(db.baselines.size).toBe(1);
  });

  it("refuses an empty repository (no commits to start from)", async () => {
    const github = fakeGitHub({ head: new GitHubError("empty_repository") });
    expect(await code(recordBaseline(target, { store: db.store, github }))).toBe("github:empty_repository");
    expect(db.baselines.size).toBe(0);
  });
});

describe("completeWeek: baseline and ordering", () => {
  it("Week 1 needs the starting point first", async () => {
    const github = fakeGitHub({ head: S1 });
    expect(await code(completeWeek({ ...target, weekNumber: 1 }, { store: db.store, github }))).toBe(
      "baseline_required",
    );
    expect(github.getRepository).not.toHaveBeenCalled(); // fails before touching GitHub
    expect(db.checkpoints).toHaveLength(0);
  });

  it("Week 1 is compared against the baseline", async () => {
    await recordBaseline(target, { store: db.store, github: fakeGitHub({ head: S0 }) });
    const github = fakeGitHub({ head: S1 });
    const checkpoint = await completeWeek({ ...target, weekNumber: 1 }, { store: db.store, github });
    expect(github.compareCommits).toHaveBeenCalledWith("octocat", "hello-world", S0, S1);
    expect(checkpoint).toMatchObject({
      weekNumber: 1,
      commitSha: S1,
      baseCommitSha: S0,
      filesChanged: 4,
      additions: 120,
      deletions: 30,
    });
  });

  it("each later week is compared against the previous week's recorded checkpoint", async () => {
    await recordBaseline(target, { store: db.store, github: fakeGitHub({ head: S0 }) });
    await completeWeek({ ...target, weekNumber: 1 }, { store: db.store, github: fakeGitHub({ head: S1 }) });
    const github = fakeGitHub({ head: S2 });
    const week2 = await completeWeek({ ...target, weekNumber: 2 }, { store: db.store, github });
    expect(github.compareCommits).toHaveBeenCalledWith("octocat", "hello-world", S1, S2);
    expect(week2).toMatchObject({ weekNumber: 2, commitSha: S2, baseCommitSha: S1 });
    // Week 1 is untouched by recording Week 2.
    expect(db.checkpoints.find((c) => c.weekNumber === 1)).toMatchObject({ commitSha: S1, baseCommitSha: S0 });
  });

  it("weeks must be completed in order", async () => {
    await recordBaseline(target, { store: db.store, github: fakeGitHub({ head: S0 }) });
    const github = fakeGitHub({ head: S3 });
    expect(await code(completeWeek({ ...target, weekNumber: 3 }, { store: db.store, github }))).toBe(
      "previous_week_required",
    );
    expect(await code(completeWeek({ ...target, weekNumber: 2 }, { store: db.store, github }))).toBe(
      "previous_week_required",
    );
    expect(db.checkpoints).toHaveLength(0);
  });

  it.each([0, 13, -1, 1.5, NaN, Infinity])("rejects week %s", async (weekNumber) => {
    const github = fakeGitHub({ head: S1 });
    expect(await code(completeWeek({ ...target, weekNumber }, { store: db.store, github }))).toBe("invalid_week");
  });

  it("the allowed weeks follow the project's own duration, not a fixed 12", async () => {
    const github = fakeGitHub({ head: S1 });
    const short = { ...target, durationWeeks: 3 };
    expect(await code(completeWeek({ ...short, weekNumber: 4 }, { store: db.store, github }))).toBe("invalid_week");
    expect(await code(completeWeek({ ...short, weekNumber: 12 }, { store: db.store, github }))).toBe("invalid_week");
    // Week 13 is valid for a 16-week project (it still needs its earlier weeks first).
    const long = { ...target, durationWeeks: 16 };
    expect(await code(completeWeek({ ...long, weekNumber: 13 }, { store: db.store, github }))).toBe("previous_week_required");
    expect(db.checkpoints).toHaveLength(0);
  });
});

describe("completeWeek: commits during the week", () => {
  beforeEach(async () => {
    await recordBaseline(target, { store: db.store, github: fakeGitHub({ head: S0 }) });
  });

  it("many commits in a week produce ONE checkpoint at the latest commit", async () => {
    const github = fakeGitHub({ head: S3, compare: changed({ totalFiles: 12 }) });
    const checkpoint = await completeWeek({ ...target, weekNumber: 1 }, { store: db.store, github });
    expect(checkpoint.commitSha).toBe(S3);
    expect(db.checkpoints).toHaveLength(1);
  });

  it("uses the commit that is latest at the moment of clicking, not an earlier one", async () => {
    const state = { head: S1 };
    const github = fakeGitHub(state);
    state.head = S2; // student pushed again just before confirming
    const checkpoint = await completeWeek({ ...target, weekNumber: 1 }, { store: db.store, github });
    expect(checkpoint.commitSha).toBe(S2);
  });

  it("the checkpoint ignores commit message text entirely", async () => {
    const github = fakeGitHub({ head: S1 });
    await completeWeek({ ...target, weekNumber: 1 }, { store: db.store, github });
    // The service never asks GitHub for commit messages or any text about the commit.
    expect(github.getHeadCommit).toHaveBeenCalledTimes(1);
    expect(Object.keys(github)).not.toContain("getCommitMessage");
  });

  it("no new commits since the baseline is refused and records nothing", async () => {
    const github = fakeGitHub({ head: S0 });
    expect(await code(completeWeek({ ...target, weekNumber: 1 }, { store: db.store, github }))).toBe("no_new_commits");
    expect(github.compareCommits).not.toHaveBeenCalled();
    expect(db.checkpoints).toHaveLength(0);
  });

  it("no new commits since last week's checkpoint is refused", async () => {
    await completeWeek({ ...target, weekNumber: 1 }, { store: db.store, github: fakeGitHub({ head: S1 }) });
    const github = fakeGitHub({ head: S1 });
    const err = await completeWeek({ ...target, weekNumber: 2 }, { store: db.store, github }).catch((e: Error) => e);
    expect(err).toMatchObject({ code: "no_new_commits" });
    expect((err as Error).message).toMatch(/Week 1's checkpoint/);
    expect(db.checkpoints).toHaveLength(1);
  });

  it("an 'identical' comparison is also treated as no new commits", async () => {
    const github = fakeGitHub({ head: S1, compare: changed({ status: "identical", isEmpty: true, totalFiles: 0 }) });
    expect(await code(completeWeek({ ...target, weekNumber: 1 }, { store: db.store, github }))).toBe("no_new_commits");
  });

  it("new commits that change no files (empty diff) are refused", async () => {
    const github = fakeGitHub({
      head: S1,
      compare: changed({ isEmpty: true, totalFiles: 0, totalAdditions: 0, totalDeletions: 0 }),
    });
    expect(await code(completeWeek({ ...target, weekNumber: 1 }, { store: db.store, github }))).toBe("empty_diff");
    expect(db.checkpoints).toHaveLength(0);
  });

  it("a refused attempt does not use up the week: a later attempt succeeds", async () => {
    const state: Parameters<typeof fakeGitHub>[0] = { head: S0 };
    const github = fakeGitHub(state);
    expect(await code(completeWeek({ ...target, weekNumber: 1 }, { store: db.store, github }))).toBe("no_new_commits");
    state.head = S1; // student pushes
    const checkpoint = await completeWeek({ ...target, weekNumber: 1 }, { store: db.store, github });
    expect(checkpoint.commitSha).toBe(S1);
  });

  it.each(["behind", "diverged", "unknown"])("refuses when history changed (status %s)", async (status) => {
    const github = fakeGitHub({ head: S1, compare: changed({ status }) });
    expect(await code(completeWeek({ ...target, weekNumber: 1 }, { store: db.store, github }))).toBe("history_changed");
    expect(db.checkpoints).toHaveLength(0);
  });
});

describe("completeWeek: repeated and simultaneous clicks", () => {
  beforeEach(async () => {
    await recordBaseline(target, { store: db.store, github: fakeGitHub({ head: S0 }) });
  });

  it("a second click never overwrites; it reports the existing checkpoint", async () => {
    const first = await completeWeek({ ...target, weekNumber: 1 }, { store: db.store, github: fakeGitHub({ head: S1 }) });
    const github = fakeGitHub({ head: S3 }); // student pushed more after recording
    const err = await completeWeek({ ...target, weekNumber: 1 }, { store: db.store, github }).catch((e: Error) => e);
    expect(err).toMatchObject({ code: "already_recorded" });
    expect((err as CheckpointError).existing).toEqual(first);
    expect(github.getHeadCommit).not.toHaveBeenCalled(); // no GitHub call needed
    expect(db.checkpoints).toEqual([first]);
    expect(db.checkpoints[0].commitSha).toBe(S1);
  });

  it("ten rapid clicks record exactly one checkpoint", async () => {
    const github = fakeGitHub({ head: S1 });
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () => completeWeek({ ...target, weekNumber: 1 }, { store: db.store, github })),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(rejected).toHaveLength(9);
    for (const r of rejected) {
      expect(r.reason).toMatchObject({ code: "already_recorded" });
      expect(r.reason.existing?.commitSha).toBe(S1); // losers are shown the winner
    }
    expect(db.checkpoints).toHaveLength(1);
  });

  it("the database's uniqueness rule is the last line of defence", async () => {
    // Simulate losing the race only at insert time.
    const store: CheckpointStore = {
      ...db.store,
      insertCheckpoint: async (c) => {
        await db.store.insertCheckpoint(c); // the "other click" wins first
        throw new StoreConflictError();
      },
    };
    const err = await completeWeek({ ...target, weekNumber: 1 }, { store, github: fakeGitHub({ head: S1 }) }).catch(
      (e: Error) => e,
    );
    expect(err).toMatchObject({ code: "already_recorded" });
    expect((err as CheckpointError).existing?.commitSha).toBe(S1);
    expect(db.checkpoints).toHaveLength(1);
  });
});

describe("completeWeek: GitHub problems (nothing is recorded)", () => {
  beforeEach(async () => {
    await recordBaseline(target, { store: db.store, github: fakeGitHub({ head: S0 }) });
  });

  it.each(["empty_repository", "not_found", "rate_limited", "forbidden", "timeout", "unavailable"] as const)(
    "propagates GitHub %s without recording",
    async (githubCode) => {
      const github = fakeGitHub({ head: new GitHubError(githubCode) });
      expect(await code(completeWeek({ ...target, weekNumber: 1 }, { store: db.store, github }))).toBe(
        `github:${githubCode}`,
      );
      expect(db.checkpoints).toHaveLength(0);
    },
  );

  it("propagates a failure while comparing (e.g. the base commit was removed)", async () => {
    const github = fakeGitHub({ head: S1, compare: new GitHubError("invalid_ref") });
    expect(await code(completeWeek({ ...target, weekNumber: 1 }, { store: db.store, github }))).toBe(
      "github:invalid_ref",
    );
    expect(db.checkpoints).toHaveLength(0);
  });
});

describe("recorded checkpoint vs. evaluation", () => {
  it("a checkpoint carries no score, evaluation or approval", async () => {
    await recordBaseline(target, { store: db.store, github: fakeGitHub({ head: S0 }) });
    const checkpoint = await completeWeek({ ...target, weekNumber: 1 }, { store: db.store, github: fakeGitHub({ head: S1 }) });
    const keys = Object.keys(checkpoint);
    for (const forbidden of ["score", "suggestedScore", "approvedScore", "status", "evaluation", "approved"]) {
      expect(keys).not.toContain(forbidden);
    }
  });

  it("getProgress returns the baseline and checkpoints", async () => {
    expect(await getProgress(PROJECT, db.store)).toEqual({ baseline: null, checkpoints: [] });
    await recordBaseline(target, { store: db.store, github: fakeGitHub({ head: S0 }) });
    await completeWeek({ ...target, weekNumber: 1 }, { store: db.store, github: fakeGitHub({ head: S1 }) });
    const progress = await getProgress(PROJECT, db.store);
    expect(progress.baseline?.commitSha).toBe(S0);
    expect(progress.checkpoints.map((c) => c.weekNumber)).toEqual([1]);
  });
});
