import { z } from "zod";
import { errorResponse, handleUnexpected } from "@/lib/api/errors";
import { getGitHubClient } from "@/lib/github/client";
import { loadProjectRepo } from "@/lib/github/project-repo";

const ShaSchema = z.string().regex(/^[0-9a-fA-F]{7,40}$/, "Must be a commit SHA (7-40 hex characters).");

/**
 * Summary of the changes between two commit SHAs. Deliberately returns file names
 * and line counts only, never patch text: the code stays on the server and is only
 * used by evaluation. Omitted or truncated content is reported, not hidden.
 */
export async function GET(request: Request, ctx: RouteContext<"/api/projects/[id]/repo/compare">) {
  const { id } = await ctx.params;
  const params = new URL(request.url).searchParams;
  const base = ShaSchema.safeParse(params.get("base"));
  const headParam = params.get("head");
  const head = headParam === null ? null : ShaSchema.safeParse(headParam);
  if (!base.success || (head && !head.success)) {
    return errorResponse(400, "invalid_ref", "base (and head, if given) must be commit SHAs.", {
      ...(base.success ? {} : { base: "Required. Must be a commit SHA (7-40 hex characters)." }),
      ...(head && !head.success ? { head: "Must be a commit SHA (7-40 hex characters)." } : {}),
    });
  }

  try {
    const target = await loadProjectRepo(id);
    if (target instanceof Response) return target;

    const github = getGitHubClient();
    // head defaults to the latest commit on the default branch.
    let headSha = head?.data;
    if (!headSha) {
      const repository = await github.getRepository(target.owner, target.repo);
      headSha = (await github.getHeadCommit(target.owner, target.repo, repository.default_branch)).sha;
    }

    const result = await github.compareCommits(target.owner, target.repo, base.data, headSha);
    return Response.json({
      comparison: {
        baseSha: result.baseSha,
        headSha: result.headSha,
        status: result.status,
        aheadBy: result.aheadBy,
        behindBy: result.behindBy,
        totalCommits: result.totalCommits,
        isEmpty: result.isEmpty,
        totalFiles: result.totalFiles,
        filesOmitted: result.filesOmitted,
        truncated: result.truncated,
        patchChars: result.patchChars,
        files: result.files.map((file) => ({
          path: file.path,
          previousPath: file.previousPath ?? null,
          status: file.status,
          additions: file.additions,
          deletions: file.deletions,
          patchIncluded: file.patch !== undefined,
          patchTruncated: file.patchTruncated,
          patchOmittedReason: file.patchOmittedReason ?? null,
        })),
      },
      rateLimit: github.rateLimit,
    });
  } catch (error) {
    return handleUnexpected(error);
  }
}
