import { ReviewError, type NewDecision, type ReviewStore } from "@/lib/review/service";
import type { Project } from "@/lib/schemas/project";
import type { StoredEvaluation } from "@/lib/evaluation/service";
import type { TeacherDecision } from "@/lib/schemas/teacher-decision";

/**
 * In-memory review store with the database's rules: one decision per evaluation,
 * decided evaluations are final, and the decision and the status change together.
 */
export function memoryReviewStore(
  rows: StoredEvaluation[],
  projects: Pick<Project, "id" | "title" | "repoUrl">[],
) {
  const decisions: TeacherDecision[] = [];
  let n = 0;
  const tick = () => Promise.resolve(); // lets concurrent calls interleave

  const project = (id: string) => projects.find((p) => p.id === id) ?? { id, title: "Unknown", repoUrl: "https://github.com/a/b" };

  const store: ReviewStore = {
    async list(status) {
      await tick();
      return rows
        .filter((r) => status === "all" || r.evaluation.status === status)
        .map(({ evaluation: e }) => ({
          evaluationId: e.id,
          projectId: e.projectId,
          projectTitle: project(e.projectId).title,
          weekNumber: e.weekNumber,
          status: e.status,
          suggestedScore: e.suggestedScore,
          confidence: e.confidence.level,
          createdAt: e.createdAt,
        }));
    },
    async getDetail(id) {
      await tick();
      const row = rows.find((r) => r.evaluation.id === id);
      if (!row) return null;
      return {
        evaluation: row.evaluation,
        snapshot: row.snapshot,
        project: project(row.evaluation.projectId),
        decision: decisions.find((d) => d.evaluationId === id) ?? null,
      };
    },
    async decide(d: NewDecision) {
      await tick();
      const row = rows.find((r) => r.evaluation.id === d.evaluationId);
      if (!row) throw new ReviewError("not_found");
      if (row.evaluation.status !== "pending_review" || decisions.some((x) => x.evaluationId === d.evaluationId)) {
        throw new ReviewError("already_decided");
      }
      const saved: TeacherDecision = {
        id: `00000000-0000-4000-a000-${String(++n).padStart(12, "0")}`,
        evaluationId: d.evaluationId,
        decision: d.decision,
        approvedScore: d.approvedScore,
        approvedFeedback: d.approvedFeedback,
        comment: d.comment,
        decidedAt: "2026-10-26T12:00:00+00:00",
      };
      decisions.push(saved);
      row.evaluation = {
        ...row.evaluation,
        status: d.decision === "approve" ? "approved" : d.decision === "edit" ? "edited" : "rejected",
      };
      return saved;
    },
    async listResults(projectId) {
      await tick();
      return decisions.flatMap((d) => {
        const e = rows.find((r) => r.evaluation.id === d.evaluationId)?.evaluation;
        if (!e || e.projectId !== projectId) return [];
        return [
          {
            weekNumber: e.weekNumber,
            outcome: e.status as "approved" | "edited" | "rejected",
            officialScore: d.approvedScore,
            feedback: d.approvedFeedback,
            decidedAt: d.decidedAt,
          },
        ];
      });
    },
  };
  return { store, decisions };
}
