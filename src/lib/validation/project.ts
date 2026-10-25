import { z } from "zod";

export const PROJECT_DURATION_WEEKS = 12;

// Accepts https://github.com/<owner>/<repo>, optionally with ".git" or a trailing slash.
const GITHUB_REPO_URL =
  /^https:\/\/github\.com\/([A-Za-z0-9][A-Za-z0-9-]{0,38})\/([A-Za-z0-9._-]+?)(?:\.git)?\/?$/;

export function parseGitHubRepoUrl(
  url: string,
): { owner: string; repo: string } | null {
  const match = GITHUB_REPO_URL.exec(url.trim());
  if (!match) return null;
  const [, owner, repo] = match;
  if (repo === "." || repo === "..") return null;
  return { owner, repo };
}

export const projectFormSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, "Project title is required.")
    .min(3, "Project title must be at least 3 characters.")
    .max(100, "Project title must be at most 100 characters."),
  description: z
    .string()
    .trim()
    .min(1, "Project description is required.")
    .min(20, "Please describe the project in at least 20 characters.")
    .max(1000, "Project description must be at most 1000 characters."),
  repoUrl: z
    .string()
    .trim()
    .min(1, "GitHub repository URL is required.")
    .refine(
      (value) => parseGitHubRepoUrl(value) !== null,
      "Enter a valid GitHub repository URL, e.g. https://github.com/owner/repo.",
    ),
  durationWeeks: z.literal(PROJECT_DURATION_WEEKS),
});

export type ProjectFormValues = z.output<typeof projectFormSchema>;
export type ProjectFormField = "title" | "description" | "repoUrl";
export type ProjectFormErrors = Partial<Record<ProjectFormField, string>>;

export type ProjectValidationResult =
  | { success: true; data: ProjectFormValues }
  | { success: false; errors: ProjectFormErrors };

const FIELDS: readonly ProjectFormField[] = [
  "title",
  "description",
  "repoUrl",
];

export function validateProjectForm(
  input: Record<ProjectFormField, string>,
): ProjectValidationResult {
  const result = projectFormSchema.safeParse({
    ...input,
    durationWeeks: PROJECT_DURATION_WEEKS,
  });
  if (result.success) return { success: true, data: result.data };

  const errors: ProjectFormErrors = {};
  for (const issue of result.error.issues) {
    const field = FIELDS.find((f) => f === issue.path[0]);
    if (field && !errors[field]) errors[field] = issue.message;
  }
  return { success: false, errors };
}
