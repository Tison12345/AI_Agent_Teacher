import { checkpointErrorResponse } from "@/lib/checkpoints/http";
import { checkpointStore } from "@/lib/checkpoints/repository";
import { recordBaseline } from "@/lib/checkpoints/service";
import { getGitHubClient } from "@/lib/github/client";
import { loadProjectRepo } from "@/lib/github/project-repo";

/** Records the project's starting point (latest commit on the default branch). Once only. */
export async function POST(_request: Request, ctx: RouteContext<"/api/projects/[id]/baseline">) {
  const { id } = await ctx.params;
  try {
    const target = await loadProjectRepo(id);
    if (target instanceof Response) return target;
    const baseline = await recordBaseline(
      { projectId: id, ...target },
      { store: checkpointStore, github: getGitHubClient() },
    );
    return Response.json({ baseline }, { status: 201 });
  } catch (error) {
    return checkpointErrorResponse(error);
  }
}
