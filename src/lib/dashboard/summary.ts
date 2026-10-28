import type { Progress } from "@/lib/schemas/checkpoint";
import type { Project } from "@/lib/schemas/project";
import type { StudentResult } from "@/lib/schemas/review";

/** Mean rounded to one decimal place, or null when there is nothing to average. */
export function average(numbers: number[]): number | null {
  if (numbers.length === 0) return null;
  return Math.round((numbers.reduce((a, b) => a + b, 0) / numbers.length) * 10) / 10;
}

/** "owner/repo" from a GitHub URL, or the URL itself when it does not look like one. */
export function repoName(url: string): string {
  try {
    const parts = new URL(url).pathname.split("/").filter(Boolean);
    return parts.length >= 2 ? `${parts[0]}/${parts[1].replace(/\.git$/, "")}` : url;
  } catch {
    return url;
  }
}

/** One week on the score chart. `note` says why a week has no number. */
export type WeekPoint = { weekNumber: number; score: number | null; note: string };

/** Everything a student sees about one project at a glance, worked out from real records only. */
export type ProjectSummary = {
  durationWeeks: number;
  recorded: number;
  /** Weeks the teacher approved or edited: they carry an official score. */
  approved: number;
  /** Weeks recorded and evaluated but not yet decided. */
  pendingReview: number;
  rejected: number;
  unrecorded: number;
  scores: number[];
  average: number | null;
  weeks: WeekPoint[];
};

export function summarizeProject(
  project: Pick<Project, "durationWeeks">,
  progress: Pick<Progress, "checkpoints" | "evaluations">,
  results: StudentResult[],
): ProjectSummary {
  const { durationWeeks } = project;
  const recordedWeeks = new Set(progress.checkpoints.map((c) => c.weekNumber));
  const statusOf = (week: number) => progress.evaluations.find((e) => e.weekNumber === week)?.status;
  const scores = results.flatMap((r) => (r.officialScore === null ? [] : [r.officialScore]));

  const weeks: WeekPoint[] = Array.from({ length: durationWeeks }, (_, i) => {
    const weekNumber = i + 1;
    const result = results.find((r) => r.weekNumber === weekNumber);
    if (result && result.officialScore !== null) return { weekNumber, score: result.officialScore, note: "" };
    if (!recordedWeeks.has(weekNumber)) return { weekNumber, score: null, note: "Not recorded" };
    const status = statusOf(weekNumber);
    if (result || status === "rejected" || status === "approved" || status === "edited") {
      return { weekNumber, score: null, note: "No mark" };
    }
    return { weekNumber, score: null, note: status === "pending_review" ? "Awaiting review" : "Not evaluated" };
  });

  return {
    durationWeeks,
    recorded: recordedWeeks.size,
    approved: progress.evaluations.filter((e) => e.status === "approved" || e.status === "edited").length,
    pendingReview: progress.evaluations.filter((e) => e.status === "pending_review").length,
    rejected: progress.evaluations.filter((e) => e.status === "rejected").length,
    unrecorded: Math.max(0, durationWeeks - recordedWeeks.size),
    scores,
    average: average(scores),
    weeks,
  };
}

/** The totals over every project that loaded. */
export function summarizeStudent(summaries: ProjectSummary[]) {
  const scores = summaries.flatMap((s) => s.scores);
  return {
    projects: summaries.length,
    average: average(scores),
    scoredWeeks: scores.length,
    recorded: summaries.reduce((n, s) => n + s.recorded, 0),
    totalWeeks: summaries.reduce((n, s) => n + s.durationWeeks, 0),
    pendingReview: summaries.reduce((n, s) => n + s.pendingReview, 0),
    approved: summaries.reduce((n, s) => n + s.approved, 0),
  };
}
