import { average } from "@/lib/dashboard/summary";
import type { Project } from "@/lib/schemas/project";
import type { QueueItem } from "@/lib/schemas/review";
import { StatCard } from "./ui";

/** The official scores in a set of queue items: only decided weeks that carry a score. */
export function officialScores(items: QueueItem[]): number[] {
  return items.flatMap((i) => (i.status !== "pending_review" && i.officialScore !== null ? [i.officialScore] : []));
}

/**
 * Numbers for the top of the faculty dashboard, all worked out from the real data:
 * nothing is estimated and nothing is shown for data that does not exist yet.
 */
export function FacultyStats({ items, projects }: { items: QueueItem[]; projects: Project[] }) {
  const waiting = items.filter((i) => i.status === "pending_review").length;
  const reviewed = items.length - waiting;
  const scores = officialScores(items);
  const evaluatedProjects = new Set(items.map((i) => i.projectId)).size;
  const taken = items.flatMap((i) =>
    i.quiz.status === "taken" && i.quiz.total ? [((i.quiz.correctCount ?? 0) / i.quiz.total) * 100] : [],
  );
  const quizAverage = average(taken);
  const averageScore = average(scores);

  return (
    <section aria-label="Summary" className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
      <StatCard icon="folder" label="Total projects" value={projects.length} hint="created by students" />
      <StatCard
        icon="repo"
        label="Projects with evaluations"
        value={evaluatedProjects}
        hint={projects.length === 0 ? "no projects yet" : `of ${projects.length}`}
      />
      <StatCard
        icon="chart"
        label="Average official score"
        value={averageScore === null ? "–" : averageScore}
        hint={
          averageScore === null
            ? "no scored weeks yet"
            : `across ${scores.length} scored ${scores.length === 1 ? "week" : "weeks"}`
        }
      />
      <StatCard
        icon="clock"
        label="Pending reviews"
        value={waiting}
        hint={waiting === 0 ? "all caught up" : "waiting for your decision"}
      />
      <StatCard icon="check" label="Reviewed weeks" value={reviewed} hint="approved, edited or rejected" />
      <StatCard
        icon="spark"
        label="Quiz average"
        value={quizAverage === null ? "–" : `${quizAverage}%`}
        hint={
          taken.length === 0
            ? "no quizzes taken yet"
            : `${taken.length} ${taken.length === 1 ? "quiz" : "quizzes"} taken`
        }
      />
    </section>
  );
}
