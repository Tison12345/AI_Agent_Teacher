import "server-only";
import { errorResponse } from "@/lib/api/errors";
import { getProject } from "@/lib/projects/repository";
import { parseGitHubRepoUrl } from "@/lib/validation/project";
import { z } from "zod";

export type ProjectRepo = { owner: string; repo: string; durationWeeks: number };

/**
 * Shared by the repo routes: checks the id, loads the project and parses its
 * repository URL. Returns a ready-to-send error Response on failure.
 */
export async function loadProjectRepo(
  rawId: string,
): Promise<ProjectRepo | Response> {
  if (!z.uuid().safeParse(rawId).success) {
    return errorResponse(400, "invalid_id", "Project id must be a valid UUID.");
  }
  const project = await getProject(rawId);
  if (!project) return errorResponse(404, "not_found", "Project not found.");
  const parsed = parseGitHubRepoUrl(project.repoUrl);
  if (!parsed) {
    return errorResponse(400, "github_invalid_repository", "That is not a valid GitHub repository.");
  }
  return { ...parsed, durationWeeks: project.durationWeeks };
}
