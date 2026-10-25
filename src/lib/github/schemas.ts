import { z } from "zod";

export const RepositorySchema = z.object({
  full_name: z.string(),
  private: z.boolean(),
  default_branch: z.string().min(1),
  html_url: z.string().url(),
  archived: z.boolean().optional().default(false),
  fork: z.boolean().optional().default(false),
  size: z.number().optional().default(0),
  pushed_at: z.string().nullable().optional(),
});

/** `GET /repos/{o}/{r}/commits?sha=<branch>&per_page=1` */
export const CommitListSchema = z.array(
  z.object({
    sha: z.string().regex(/^[0-9a-f]{40}$/),
    commit: z.object({
      message: z.string(),
      committer: z.object({ date: z.string().nullable().optional() }).nullable().optional(),
    }),
  }),
);

export const CompareFileSchema = z.object({
  filename: z.string(),
  status: z.string(),
  additions: z.number().default(0),
  deletions: z.number().default(0),
  changes: z.number().default(0),
  patch: z.string().optional(),
  previous_filename: z.string().optional(),
});

export const CompareSchema = z.object({
  status: z.string(),
  ahead_by: z.number(),
  behind_by: z.number(),
  total_commits: z.number(),
  files: z.array(CompareFileSchema).optional().default([]),
});

export type GitHubRepository = z.infer<typeof RepositorySchema>;
export type CompareFile = z.infer<typeof CompareFileSchema>;
