import { assembleEvaluation } from "@/lib/evaluation/assemble";
import { STRONG, WEEK, modelAnswer } from "@/lib/evaluation/fixtures";
import { memoryEvaluationStore } from "./memory-evaluation-store";
import { memoryReviewStore } from "./memory-review-store";

export const PROJECT = "123e4567-e89b-42d3-a456-426614174000";
export const OTHER_PROJECT = "223e4567-e89b-42d3-a456-426614174000";

/** An evaluation store and a review store sharing the same rows, like the real tables do. */
export function reviewWorld() {
  const evaluations = memoryEvaluationStore();
  const review = memoryReviewStore(evaluations.rows, [
    { id: PROJECT, title: "Library app", repoUrl: "https://github.com/octocat/hello-world" },
    { id: OTHER_PROJECT, title: "Other project", repoUrl: "https://github.com/octocat/other" },
  ]);

  /** Stores an AI evaluation for a week; the default parts score 94/100 with feedback. */
  async function seed(weekNumber = 1, parts: [number, number, number] = [36, 30, 28], projectId = PROJECT) {
    const assembled = assembleEvaluation(modelAnswer(parts), { criteria: WEEK.evaluationCriteria, snapshot: STRONG });
    if (!assembled.ok) throw new Error("fixture should be valid");
    return evaluations.store.insert({
      projectId,
      checkpointId: `00000000-0000-4000-8000-${String(weekNumber).padStart(11, "0")}${projectId === PROJECT ? "0" : "1"}`,
      weekNumber,
      result: assembled.value,
      snapshot: STRONG,
      model: "test-model",
    });
  }

  return { evaluations, review, seed };
}
