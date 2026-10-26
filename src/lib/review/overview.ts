import type { Checkpoint } from "@/lib/schemas/checkpoint";
import type { ProjectOverview, WeekOverview } from "@/lib/schemas/overview";
import type { Project } from "@/lib/schemas/project";
import type { StoredPlan } from "@/lib/schemas/weekly-plan";
import type { QuizStore } from "@/lib/quiz/service";
import { quizSummary, type ReviewStore } from "./service";

export type OverviewDeps = {
  getProject: (id: string) => Promise<Project | null>;
  getPlan: (projectId: string) => Promise<StoredPlan | null>;
  checkpoints: { listCheckpoints(projectId: string): Promise<Checkpoint[]> };
  review: ReviewStore;
  quizzes: QuizStore;
};

/**
 * One project, every week of it: what was recorded, the AI's recommendation, the teacher's
 * official outcome and feedback, and the student's quiz result. Weeks nobody has recorded
 * yet are listed too, so a teacher can see how far the student has got.
 * Returns null when the project does not exist.
 */
export async function buildProjectOverview(projectId: string, deps: OverviewDeps): Promise<ProjectOverview | null> {
  const project = await deps.getProject(projectId);
  if (!project) return null;

  const [plan, checkpoints, queue] = await Promise.all([
    deps.getPlan(projectId),
    deps.checkpoints.listCheckpoints(projectId),
    deps.review.list("all"),
  ]);
  const evaluations = new Map(queue.filter((q) => q.projectId === projectId).map((q) => [q.weekNumber, q]));

  const weeks: WeekOverview[] = [];
  for (let weekNumber = 1; weekNumber <= project.durationWeeks; weekNumber++) {
    const checkpoint = checkpoints.find((c) => c.weekNumber === weekNumber);
    const item = evaluations.get(weekNumber);
    const title = plan?.plan[weekNumber - 1]?.title ?? null;

    if (!checkpoint && !item) {
      weeks.push({
        weekNumber,
        title,
        state: "not_recorded",
        recordedAt: null,
        evaluationId: null,
        suggestedScore: null,
        officialScore: null,
        teacherFeedback: null,
        teacherComment: null,
        ai: null,
        quiz: quizSummary(false, null),
      });
      continue;
    }

    const detail = item ? await deps.review.getDetail(item.evaluationId) : null;
    const stored = checkpoint ? await deps.quizzes.getByCheckpoint(checkpoint.id) : null;
    const e = detail?.evaluation;
    weeks.push({
      weekNumber,
      title,
      state: item ? item.status : "not_evaluated",
      recordedAt: checkpoint?.recordedAt ?? null,
      evaluationId: item?.evaluationId ?? null,
      suggestedScore: e?.suggestedScore ?? null,
      officialScore: detail?.decision?.approvedScore ?? null,
      teacherFeedback: detail?.decision?.approvedFeedback ?? null,
      teacherComment: detail?.decision?.comment ?? null,
      ai: e
        ? {
            confidence: e.confidence.level,
            completed: e.completedRequirements,
            incomplete: e.incompleteRequirements,
            concerns: e.technicalConcerns,
            feedback: e.feedbackForNextWeek,
          }
        : null,
      quiz: quizSummary(Boolean(stored), stored?.attempt ?? null),
    });
  }

  return {
    project: {
      id: project.id,
      title: project.title,
      description: project.description,
      repoUrl: project.repoUrl,
      durationWeeks: project.durationWeeks,
    },
    weeks,
  };
}
