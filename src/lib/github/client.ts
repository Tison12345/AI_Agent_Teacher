import "server-only";
import { z } from "zod";
import { prioritizeFiles, processDiffFiles, type DiffLimits, type ProcessedDiff } from "./diff";
import { GitHubError } from "./errors";
import {
  CommitListSchema,
  CompareSchema,
  RepositorySchema,
  type GitHubRepository,
} from "./schemas";

const API_ROOT = "https://api.github.com";
const REQUEST_TIMEOUT_MS = 15_000;
const FILES_PER_PAGE = 100;
const MAX_FILE_PAGES = 3;

const OWNER_RE = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/;
const REPO_RE = /^[A-Za-z0-9._-]{1,100}$/;
const SHA_RE = /^[0-9a-f]{7,40}$/;

export type RateLimit = { limit: number; remaining: number; resetAt: string } | null;

export type CompareResult = ProcessedDiff & {
  /** Where `head` stands relative to `base`. Normal is "ahead". */
  status: "ahead" | "behind" | "identical" | "diverged" | "unknown";
  aheadBy: number;
  behindBy: number;
  totalCommits: number;
  baseSha: string;
  headSha: string;
  /** True when there is nothing to evaluate: no file changes at all. */
  isEmpty: boolean;
};

export type HeadCommit = { sha: string; branch: string; message: string; date: string | null };

type ClientOptions = {
  token?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

function checkRepoName(owner: string, repo: string) {
  if (!OWNER_RE.test(owner) || !REPO_RE.test(repo) || repo === "." || repo === "..") {
    throw new GitHubError("invalid_repository");
  }
}

/** Parses a response header number, returning null if absent or malformed. */
function headerNumber(res: Response, name: string): number | null {
  const raw = res.headers.get(name);
  if (raw === null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function readRateLimit(res: Response): RateLimit {
  const limit = headerNumber(res, "x-ratelimit-limit");
  const remaining = headerNumber(res, "x-ratelimit-remaining");
  const reset = headerNumber(res, "x-ratelimit-reset");
  if (limit === null || remaining === null || reset === null) return null;
  return { limit, remaining, resetAt: new Date(reset * 1000).toISOString() };
}

/**
 * Read-only GitHub REST client. One instance per request: it remembers the
 * latest rate-limit headers it saw. The token is only ever sent to api.github.com
 * and never appears in errors or return values.
 */
export function createGitHubClient(options: ClientOptions = {}) {
  const token = options.token?.trim() || undefined;
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
  let rateLimit: RateLimit = null;

  async function request(path: string, abort?: AbortSignal): Promise<unknown> {
    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "co-learning-agent",
    };
    if (token) headers.Authorization = `Bearer ${token}`;

    let res: Response;
    try {
      res = await fetchImpl(`${API_ROOT}${path}`, {
        headers,
        cache: "no-store",
        signal: abort ? AbortSignal.any([AbortSignal.timeout(timeoutMs), abort]) : AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      const name = error instanceof Error ? error.name : "";
      console.error("[github] request failed:", name);
      throw new GitHubError(name === "TimeoutError" || name === "AbortError" ? "timeout" : "unavailable");
    }

    rateLimit = readRateLimit(res) ?? rateLimit;
    if (!res.ok) throw await toError(res);

    try {
      return await res.json();
    } catch {
      throw new GitHubError("invalid_response");
    }
  }

  async function toError(res: Response): Promise<GitHubError> {
    const body: unknown = await res.json().catch(() => null);
    const message =
      typeof body === "object" && body !== null && "message" in body
        ? String((body as { message: unknown }).message)
        : "";
    const status = res.status;
    console.error("[github] API error, status", status);

    if (status === 401) return new GitHubError("bad_credentials");

    if (status === 403 || status === 429) {
      const remaining = headerNumber(res, "x-ratelimit-remaining");
      const retryAfter = headerNumber(res, "retry-after");
      if (status === 429 || remaining === 0 || retryAfter !== null || /rate limit/i.test(message)) {
        const reset = headerNumber(res, "x-ratelimit-reset");
        const resetAt =
          reset !== null
            ? new Date(reset * 1000).toISOString()
            : retryAfter !== null
              ? new Date(Date.now() + retryAfter * 1000).toISOString()
              : undefined;
        return new GitHubError("rate_limited", { resetAt });
      }
      return new GitHubError("forbidden");
    }

    if (status === 404) {
      return /no commit found|not a valid commit/i.test(message)
        ? new GitHubError("invalid_ref")
        : new GitHubError("not_found", { hadToken: Boolean(token) });
    }
    if (status === 409) return new GitHubError("empty_repository");
    if (status === 422) return new GitHubError("invalid_ref");
    if (status === 451) return new GitHubError("blocked");
    return new GitHubError("unavailable");
  }

  function parse<T>(schema: z.ZodType<T>, data: unknown): T {
    const result = schema.safeParse(data);
    if (!result.success) {
      console.error("[github] unexpected response shape");
      throw new GitHubError("invalid_response");
    }
    return result.data;
  }

  return {
    get authenticated() {
      return Boolean(token);
    },
    /** Rate-limit info from the most recent response, if GitHub sent it. */
    get rateLimit(): RateLimit {
      return rateLimit;
    },

    async getRepository(owner: string, repo: string): Promise<GitHubRepository> {
      checkRepoName(owner, repo);
      return parse(RepositorySchema, await request(`/repos/${owner}/${repo}`));
    },

    /** Latest commit on a branch. Throws `empty_repository` if there are no commits. */
    async getHeadCommit(owner: string, repo: string, branch: string): Promise<HeadCommit> {
      checkRepoName(owner, repo);
      const data = await request(
        `/repos/${owner}/${repo}/commits?sha=${encodeURIComponent(branch)}&per_page=1`,
      );
      const [latest] = parse(CommitListSchema, data);
      if (!latest) throw new GitHubError("empty_repository");
      return {
        sha: latest.sha,
        branch,
        message: latest.commit.message.split("\n")[0].slice(0, 200),
        date: latest.commit.committer?.date ?? null,
      };
    },

    /**
     * Changes between two commit SHAs (base...head), bounded by DIFF_LIMITS.
     * Refs must be commit SHAs, never branch names or commit messages.
     */
    async compareCommits(
      owner: string,
      repo: string,
      base: string,
      head: string,
      limits?: DiffLimits,
      /** Spend the size budget on source code before tests, docs and config. */
      prioritize = false,
      /** Stops the requests when a workflow run loses its lease. */
      abort?: AbortSignal,
    ): Promise<CompareResult> {
      checkRepoName(owner, repo);
      const baseSha = base.toLowerCase();
      const headSha = head.toLowerCase();
      if (!SHA_RE.test(baseSha) || !SHA_RE.test(headSha)) {
        throw new GitHubError("invalid_ref");
      }

      const files: z.infer<typeof CompareSchema>["files"] = [];
      let first: z.infer<typeof CompareSchema> | null = null;
      let moreFiles = false;
      for (let page = 1; page <= MAX_FILE_PAGES; page++) {
        let raw: unknown;
        try {
          raw = await request(
            `/repos/${owner}/${repo}/compare/${baseSha}...${headSha}?per_page=${FILES_PER_PAGE}&page=${page}`,
            abort,
          );
        } catch (error) {
          // GitHub answers 404 both for a missing repository and for an unknown commit.
          // If the repository itself is readable, the commit is what is missing.
          if (error instanceof GitHubError && error.code === "not_found") {
            await request(`/repos/${owner}/${repo}`, abort); // rethrows not_found if the repo is the problem
            throw new GitHubError("invalid_ref");
          }
          throw error;
        }
        const data = parse(CompareSchema, raw);
        first ??= data;
        files.push(...data.files);
        if (data.files.length < FILES_PER_PAGE) break;
        // A full last page we will not read means GitHub has more files than we fetched.
        moreFiles = page === MAX_FILE_PAGES;
      }
      if (!first) throw new GitHubError("invalid_response");
      const firstPage = first;

      const diff = processDiffFiles(prioritize ? prioritizeFiles(files) : files, limits);
      const status = (["ahead", "behind", "identical", "diverged"] as const).find(
        (s) => s === firstPage.status,
      );
      return {
        ...diff,
        truncated: diff.truncated || moreFiles,
        status: status ?? "unknown",
        aheadBy: firstPage.ahead_by,
        behindBy: firstPage.behind_by,
        totalCommits: firstPage.total_commits,
        baseSha,
        headSha,
        isEmpty: diff.totalFiles === 0,
      };
    },
  };
}

export type GitHubClient = ReturnType<typeof createGitHubClient>;

/** Builds a client from the server environment (GITHUB_TOKEN is optional). */
export function getGitHubClient(): GitHubClient {
  return createGitHubClient({ token: process.env.GITHUB_TOKEN });
}
