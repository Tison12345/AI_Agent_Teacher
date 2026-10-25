import { z } from "zod";

/** A project lasts between 1 and 16 weeks; the teacher or student chooses when it is created. */
export const MIN_DURATION_WEEKS = 1;
export const MAX_DURATION_WEEKS = 16;
export const DEFAULT_DURATION_WEEKS = 12;

export const DURATION_MESSAGE = `Duration must be a whole number of weeks from ${MIN_DURATION_WEEKS} to ${MAX_DURATION_WEEKS}.`;

export const durationWeeksSchema = z
  .number({ error: "Enter the number of weeks." })
  .int(DURATION_MESSAGE)
  .min(MIN_DURATION_WEEKS, DURATION_MESSAGE)
  .max(MAX_DURATION_WEEKS, DURATION_MESSAGE);

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
  durationWeeks: durationWeeksSchema,
});

export type ProjectFormValues = z.output<typeof projectFormSchema>;
export type ProjectFormField = "title" | "description" | "repoUrl" | "durationWeeks";
export type ProjectFormErrors = Partial<Record<ProjectFormField, string>>;

export type ProjectValidationResult =
  | { success: true; data: ProjectFormValues }
  | { success: false; errors: ProjectFormErrors };

const FIELDS: readonly ProjectFormField[] = [
  "title",
  "description",
  "repoUrl",
  "durationWeeks",
];

export function validateProjectForm(
  input: Record<ProjectFormField, string>,
): ProjectValidationResult {
  // The form field is text. Only a plain number is read as one: a blank entry is "missing"
  // (not 0), and forms such as "1e1" or "4 weeks" are not numbers.
  const weeks = input.durationWeeks.trim();
  const result = projectFormSchema.safeParse({
    ...input,
    durationWeeks: weeks === "" ? undefined : /^-?\d+(\.\d+)?$/.test(weeks) ? Number(weeks) : Number.NaN,
  });
  if (result.success) return { success: true, data: result.data };

  const errors: ProjectFormErrors = {};
  for (const issue of result.error.issues) {
    const field = FIELDS.find((f) => f === issue.path[0]);
    if (field && !errors[field]) errors[field] = issue.message;
  }
  return { success: false, errors };
}
