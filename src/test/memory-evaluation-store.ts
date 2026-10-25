import { EvaluationSchema, type Evaluation } from "@/lib/schemas/evaluation";
import {
  EvaluationConflictError,
  type EvaluationStore,
  type StoredEvaluation,
} from "@/lib/evaluation/service";

/** In-memory evaluation store with the database's one-per-checkpoint rule. */
export function memoryEvaluationStore() {
  const rows: StoredEvaluation[] = [];
  let n = 0;
  const tick = () => Promise.resolve(); // lets concurrent calls interleave

  const store: EvaluationStore = {
    async getByCheckpoint(checkpointId) {
      await tick();
      return rows.find((r) => r.evaluation.checkpointId === checkpointId) ?? null;
    },
    async insert(e) {
      await tick();
      if (rows.some((r) => r.evaluation.checkpointId === e.checkpointId)) {
        throw new EvaluationConflictError();
      }
      const { suggestedScore, ...result } = e.result;
      const evaluation: Evaluation = EvaluationSchema.parse({
        id: `00000000-0000-4000-9000-${String(++n).padStart(12, "0")}`,
        projectId: e.projectId,
        checkpointId: e.checkpointId,
        weekNumber: e.weekNumber,
        suggestedScore,
        ...result,
        model: e.model,
        status: "pending_review",
        createdAt: "2026-10-26T10:00:00+00:00",
      });
      const stored = { evaluation, snapshot: e.snapshot };
      rows.push(stored);
      return stored;
    },
    async listStatuses(projectId) {
      await tick();
      return rows
        .filter((r) => r.evaluation.projectId === projectId)
        .map((r) => ({ weekNumber: r.evaluation.weekNumber, status: r.evaluation.status }));
    },
  };
  return { store, rows };
}
