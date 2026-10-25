import { handleUnexpected } from "@/lib/api/errors";
import { getGitHubClient } from "@/lib/github/client";
import { GitHubError } from "@/lib/github/errors";
import { loadProjectRepo } from "@/lib/github/project-repo";

/** Read-only look at the project's GitHub repository: metadata, default branch, latest commit. */
export async function GET(_request: Request, ctx: RouteContext<"/api/projects/[id]/repo">) {
  const { id } = await ctx.params;
  try {
    const target = await loadProjectRepo(id);
    if (target instanceof Response) return target;

    const github = getGitHubClient();
    const repository = await github.getRepository(target.owner, target.repo);

    let head = null;
    let isEmpty = false;
    try {
      head = await github.getHeadCommit(target.owner, target.repo, repository.default_branch);
    } catch (error) {
      if (error instanceof GitHubError && error.code === "empty_repository") isEmpty = true;
      else throw error;
    }

    return Response.json({
      repository: {
        fullName: repository.full_name,
        isPrivate: repository.private,
        defaultBranch: repository.default_branch,
        htmlUrl: repository.html_url,
        archived: repository.archived,
      },
      head,
      isEmpty,
      authenticated: github.authenticated,
      rateLimit: github.rateLimit,
    });
  } catch (error) {
    return handleUnexpected(error);
  }
}
