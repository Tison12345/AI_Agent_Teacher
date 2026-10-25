import { z } from "zod";
import { PROJECT_DURATION_WEEKS } from "@/lib/validation/project";

export const ProjectSchema = z.object({
  id: z.uuid(),
  title: z.string().min(3).max(100),
  description: z.string().min(20).max(1000),
  repoUrl: z.string().url(),
  durationWeeks: z.literal(PROJECT_DURATION_WEEKS),
  createdAt: z.iso.datetime({ offset: true }),
});

export type Project = z.infer<typeof ProjectSchema>;
