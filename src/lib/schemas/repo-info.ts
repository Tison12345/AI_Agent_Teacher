import { z } from "zod";

/** What the UI receives from GET /api/projects/[id]/repo. */
export const RepoInfoSchema = z.object({
  repository: z.object({
    fullName: z.string(),
    isPrivate: z.boolean(),
    defaultBranch: z.string(),
    htmlUrl: z.string().url(),
    archived: z.boolean(),
  }),
  head: z
    .object({
      sha: z.string(),
      branch: z.string(),
      message: z.string(),
      date: z.string().nullable(),
    })
    .nullable(),
  isEmpty: z.boolean(),
  authenticated: z.boolean(),
  rateLimit: z
    .object({ limit: z.number(), remaining: z.number(), resetAt: z.string() })
    .nullable(),
});

export type RepoInfo = z.infer<typeof RepoInfoSchema>;
