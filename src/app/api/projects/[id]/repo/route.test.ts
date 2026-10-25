import { beforeEach, describe, expect, it, vi } from "vitest";
import { GitHubError } from "@/lib/github/errors";

const mocks = vi.hoisted(() => ({
  getProject: vi.fn(),
  client: {
    authenticated: false,
    rateLimit: null as unknown,
    getRepository: vi.fn(),
    getHeadCommit: vi.fn(),
    compareCommits: vi.fn(),
  },
}));

vi.mock("@/lib/projects/repository", () => ({ getProject: mocks.getProject }));
vi.mock("@/lib/github/client", () => ({ getGitHubClient: () => mocks.client }));
vi.mock("@/lib/db/supabase", () => ({ StorageConfigError: class extends Error {} }));

import { GET as getCompare } from "./compare/route";
import { GET as getRepo } from "./route";

const id = "123e4567-e89b-42d3-a456-426614174000";
const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);
const project = { id, repoUrl: "https://github.com/octocat/hello-world" };
const repository = {
  full_name: "octocat/hello-world",
  private: false,
  default_branch: "main",
  html_url: "https://github.com/octocat/hello-world",
  archived: false,
};
const head = { sha: SHA_B, branch: "main", message: "Add parser", date: null };
const ctx = (value: string) => ({ params: Promise.resolve({ id: value }) }) as never;
const call = (url = "http://localhost/api/x") => new Request(url);

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.getProject.mockResolvedValue(project);
  mocks.client.rateLimit = { limit: 60, remaining: 59, resetAt: "2027-01-01T00:00:00.000Z" };
  mocks.client.getRepository.mockResolvedValue(repository);
  mocks.client.getHeadCommit.mockResolvedValue(head);
});

describe("GET /api/projects/[id]/repo", () => {
  it("returns metadata, default branch and the latest commit for the project's repo", async () => {
    const res = await getRepo(call(), ctx(id));
    expect(res.status).toBe(200);
    expect(mocks.client.getRepository).toHaveBeenCalledWith("octocat", "hello-world");
    expect(mocks.client.getHeadCommit).toHaveBeenCalledWith("octocat", "hello-world", "main");
    const body = await res.json();
    expect(body.repository).toMatchObject({ fullName: "octocat/hello-world", defaultBranch: "main", isPrivate: false });
    expect(body.head.sha).toBe(SHA_B);
    expect(body.isEmpty).toBe(false);
    expect(body.rateLimit.remaining).toBe(59);
  });

  it("reports an empty repository instead of failing", async () => {
    mocks.client.getHeadCommit.mockRejectedValue(new GitHubError("empty_repository"));
    const body = await (await getRepo(call(), ctx(id))).json();
    expect(body).toMatchObject({ isEmpty: true, head: null });
  });

  it("rejects bad ids and unknown projects without calling GitHub", async () => {
    expect((await getRepo(call(), ctx("nope"))).status).toBe(400);
    mocks.getProject.mockResolvedValue(null);
    expect((await getRepo(call(), ctx(id))).status).toBe(404);
    expect(mocks.client.getRepository).not.toHaveBeenCalled();
  });

  it.each([
    ["not_found", 404],
    ["forbidden", 403],
    ["rate_limited", 429],
    ["bad_credentials", 502],
    ["timeout", 504],
  ] as const)("maps GitHub %s to HTTP %i with a safe message", async (code, status) => {
    mocks.client.getRepository.mockRejectedValue(new GitHubError(code));
    const res = await getRepo(call(), ctx(id));
    expect(res.status).toBe(status);
    expect((await res.json()).error.code).toBe(`github_${code}`);
  });
});

describe("GET /api/projects/[id]/repo/compare", () => {
  const result = {
    baseSha: SHA_A,
    headSha: SHA_B,
    status: "ahead",
    aheadBy: 2,
    behindBy: 0,
    totalCommits: 2,
    isEmpty: false,
    totalFiles: 2,
    filesOmitted: 0,
    truncated: false,
    patchChars: 40,
    files: [
      { path: "src/a.ts", status: "modified", additions: 3, deletions: 1, patch: "SECRET PATCH TEXT", patchTruncated: false },
      { path: "package-lock.json", status: "modified", additions: 9, deletions: 9, patchTruncated: false, patchOmittedReason: "ignored" },
    ],
  };

  it("returns a summary and never the patch text", async () => {
    mocks.client.compareCommits.mockResolvedValue(result);
    const res = await getCompare(call(`http://localhost/x?base=${SHA_A}&head=${SHA_B}`), ctx(id));
    expect(res.status).toBe(200);
    expect(mocks.client.compareCommits).toHaveBeenCalledWith("octocat", "hello-world", SHA_A, SHA_B);
    const text = await res.text();
    expect(text).not.toContain("SECRET PATCH TEXT");
    const body = JSON.parse(text);
    expect(body.comparison.files[0]).toMatchObject({ path: "src/a.ts", patchIncluded: true, additions: 3 });
    expect(body.comparison.files[1]).toMatchObject({ patchIncluded: false, patchOmittedReason: "ignored" });
    expect(body.comparison).toMatchObject({ status: "ahead", isEmpty: false, truncated: false });
  });

  it("uses the default branch's latest commit when head is omitted", async () => {
    mocks.client.compareCommits.mockResolvedValue(result);
    await getCompare(call(`http://localhost/x?base=${SHA_A}`), ctx(id));
    expect(mocks.client.compareCommits).toHaveBeenCalledWith("octocat", "hello-world", SHA_A, SHA_B);
  });

  it.each([
    ["", "missing base"],
    ["?base=main", "branch name as base"],
    [`?base=${SHA_A}&head=HEAD`, "branch-like head"],
    ["?base=Add%20week%201", "commit message text"],
    [`?base=${SHA_A};ls`, "injection attempt"],
  ])("rejects %j (%s) before contacting GitHub", async (query) => {
    const res = await getCompare(call(`http://localhost/x${query}`), ctx(id));
    expect(res.status).toBe(400);
    expect(mocks.client.compareCommits).not.toHaveBeenCalled();
    expect(mocks.client.getRepository).not.toHaveBeenCalled();
  });

  it("maps an unknown commit to 422", async () => {
    mocks.client.compareCommits.mockRejectedValue(new GitHubError("invalid_ref"));
    const res = await getCompare(call(`http://localhost/x?base=${SHA_A}&head=${SHA_B}`), ctx(id));
    expect(res.status).toBe(422);
  });
});
