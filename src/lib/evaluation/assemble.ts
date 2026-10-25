import { z } from "zod";
import type {
  Evaluation,
  ReviewScope,
  Snapshot,
} from "@/lib/schemas/evaluation";
import type { EvaluationCriterion } from "@/lib/schemas/weekly-plan";

const text = (max: number) => z.string().trim().min(1).max(max);

/** What the model is asked to return. Totals and scope are computed by our code. */
export const ModelEvaluationSchema = z.object({
  criteria: z.array(
    z.object({
      name: text(200),
      score: z.number(),
      rationale: text(700),
      evidence: z
        .array(z.object({ filePath: text(300), observation: text(500) }))
        .max(4),
    }),
  ),
  completedRequirements: z.array(text(400)).max(15),
  incompleteRequirements: z.array(text(400)).max(15),
  technicalConcerns: z.array(text(500)).max(10),
  feedbackForNextWeek: z.array(text(500)).min(1).max(6),
  confidence: z.object({
    level: z.enum(["low", "medium", "high"]),
    uncertainties: z.array(text(400)).max(8),
  }),
});

export type ModelEvaluation = z.infer<typeof ModelEvaluationSchema>;

export type AssembledEvaluation = Pick<
  Evaluation,
  | "suggestedScore"
  | "criteriaAssessments"
  | "completedRequirements"
  | "incompleteRequirements"
  | "technicalConcerns"
  | "feedbackForNextWeek"
  | "confidence"
  | "reviewScope"
>;

export type AssembleResult =
  | { ok: true; value: AssembledEvaluation }
  | { ok: false; issues: string[] };

/**
 * Phrases that claim the code was run or tested. The code is never executed, so
 * an answer containing them is rejected. (Feedback is excluded on purpose:
 * advice like "make sure your tests pass" is fine.)
 */
const EXECUTION_CLAIMS: RegExp[] = [
  /\b(i|we)\s+(have\s+)?(ran|run|executed|compiled|tested|verified)\b/i,
  /\btests?\s+(all\s+)?(pass|passes|passed|passing|succeed|succeeded)\b/i,
  /\b(runs|ran|works|worked)\s+(correctly|successfully|perfectly|as expected|without (any )?(errors?|issues?|problems?))\b/i,
  /\bsuccessfully\s+(runs|executes|compiles|builds)\b/i,
  /\bbuild\s+(passes|passed|succeeds|succeeded)\b/i,
  /\b(output|result)s?\s+(is|are)\s+correct\s+when\s+(run|executed)\b/i,
];

const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();
const round1 = (n: number) => Math.round(n * 10) / 10;

/** Words that make a clause a statement of doubt or advice, not a claim ("unclear whether tests pass"). */
const HEDGES =
  /\b(whether|if|unclear|unknown|cannot|can't|could not|couldn't|not (known|shown|clear|possible)|no (way|evidence|information)|nothing (shows|confirms|indicates)|unable|should|needs? to|must|before|until|would)\b/i;

/** True if any clause flatly claims the code was run, built or tested. */
function claimsExecution(value: string): boolean {
  return value
    .split(/[.;!?\n]|,|\bbut\b/i)
    .some((clause) => EXECUTION_CLAIMS.some((re) => re.test(clause)) && !HEDGES.test(clause));
}

/** Facts about what the AI could and could not read. Computed from the diff, never by the model. */
export function buildReviewScope(snapshot: Snapshot): ReviewScope {
  const notReviewed = snapshot.files.flatMap((file) =>
    file.patchOmittedReason ? [{ path: file.path, reason: file.patchOmittedReason }] : [],
  );
  return {
    filesChanged: snapshot.totalFiles,
    filesReviewed: snapshot.files.filter((f) => f.patch !== undefined).length,
    patchesTruncated: snapshot.files.filter((f) => f.patchTruncated).length,
    notReviewed,
    filesBeyondLimit: snapshot.filesOmitted,
    codeExecuted: false,
  };
}

const LEVELS = ["low", "medium", "high"] as const;

/**
 * Checks the model's answer against the plan and the real diff, then builds the
 * stored evaluation. Returns the problems when anything does not hold, so the
 * caller can ask for a corrected answer instead of accepting bad data.
 */
export function assembleEvaluation(
  output: ModelEvaluation,
  context: { criteria: EvaluationCriterion[]; snapshot: Snapshot },
): AssembleResult {
  const { criteria, snapshot } = context;
  const issues: string[] = [];
  const reviewedPaths = new Set(
    snapshot.files.filter((f) => f.patch !== undefined).map((f) => f.path),
  );

  // 1. Exactly the plan's criteria, once each.
  const byName = new Map<string, ModelEvaluation["criteria"][number]>();
  for (const item of output.criteria) {
    const key = norm(item.name);
    if (byName.has(key)) issues.push(`criterion "${item.name}" appears more than once`);
    byName.set(key, item);
  }
  for (const criterion of criteria) {
    if (!byName.has(norm(criterion.name))) issues.push(`criterion "${criterion.name}" is missing`);
  }
  const known = new Set(criteria.map((c) => norm(c.name)));
  for (const item of output.criteria) {
    if (!known.has(norm(item.name))) issues.push(`"${item.name}" is not one of the week's criteria`);
  }

  // 2. Scores in range, and every point earned by evidence in a file that was really shown.
  const assessments: Evaluation["criteriaAssessments"] = [];
  for (const criterion of criteria) {
    const item = byName.get(norm(criterion.name));
    if (!item) continue;
    const label = `"${criterion.name}"`;
    if (!Number.isFinite(item.score) || item.score < 0 || item.score > criterion.maxPoints) {
      issues.push(`${label} score must be between 0 and ${criterion.maxPoints}`);
    }
    if (item.score > 0 && item.evidence.length === 0) {
      issues.push(`${label} has a score above 0 but no evidence; give 0 if nothing in the changes supports it`);
    }
    for (const evidence of item.evidence) {
      if (!reviewedPaths.has(evidence.filePath)) {
        issues.push(
          `${label} cites "${evidence.filePath}", which is not a file whose contents were provided in the changes`,
        );
      }
    }
    assessments.push({
      criterion: criterion.name,
      score: round1(Math.min(Math.max(item.score, 0), criterion.maxPoints)),
      maxScore: criterion.maxPoints,
      rationale: item.rationale,
      evidence: item.evidence.map((e) => ({ filePath: e.filePath, summary: e.observation })),
    });
  }

  // 3. No claim that the code was run or tested.
  const claimable = [
    ...output.criteria.flatMap((c) => [c.rationale, ...c.evidence.map((e) => e.observation)]),
    ...output.completedRequirements,
    ...output.incompleteRequirements,
    ...output.technicalConcerns,
    ...output.confidence.uncertainties,
  ];
  if (claimable.some(claimsExecution)) {
    issues.push(
      "the answer claims the code was run, built or tested, which did not happen; describe only what the changed lines show",
    );
  }

  if (issues.length > 0) return { ok: false, issues };

  // 4. The total is ours: the sum of criterion scores as a percentage of the maximum.
  const maxTotal = assessments.reduce((sum, a) => sum + a.maxScore, 0);
  const earned = assessments.reduce((sum, a) => sum + a.score, 0);
  const suggestedScore = maxTotal > 0 ? round1((earned / maxTotal) * 100) : 0;

  // 5. Confidence can only go down: limits on what the AI saw cap it.
  const reviewScope = buildReviewScope(snapshot);
  const cappedBy: string[] = [];
  let cap = 2; // index into LEVELS: 2 = high
  const lower = (to: number, reason: string) => {
    cap = Math.min(cap, to);
    cappedBy.push(reason);
  };
  if (reviewScope.filesReviewed === 0) lower(0, "No file contents were available to review.");
  if (reviewScope.patchesTruncated > 0) lower(1, `${reviewScope.patchesTruncated} file(s) were cut because of their size.`);
  if (reviewScope.filesBeyondLimit > 0) lower(1, `${reviewScope.filesBeyondLimit} more changed file(s) were beyond the review limit and were not examined.`);
  if (snapshot.truncated) lower(1, "The changes were larger than the review limit.");
  const hardToRead = reviewScope.notReviewed.filter((f) => f.reason === "binary" || f.reason === "unavailable" || f.reason === "budget");
  if (hardToRead.length > 0) {
    lower(1, `Could not read ${hardToRead.length} file(s): ${hardToRead.slice(0, 5).map((f) => `${f.path} (${f.reason})`).join(", ")}.`);
  }
  const ignoredOrDeleted = reviewScope.notReviewed.filter((f) => f.reason === "ignored" || f.reason === "deleted");
  const level = LEVELS[Math.min(LEVELS.indexOf(output.confidence.level), cap)];

  const uncertainties = [
    ...output.confidence.uncertainties,
    ...cappedBy,
    ...(ignoredOrDeleted.length > 0
      ? [`Not reviewed (deleted, dependency or generated files): ${ignoredOrDeleted.slice(0, 5).map((f) => f.path).join(", ")}.`]
      : []),
    "Based only on the changed lines. The code was not run or tested.",
  ];

  return {
    ok: true,
    value: {
      suggestedScore,
      criteriaAssessments: assessments,
      completedRequirements: output.completedRequirements,
      incompleteRequirements: output.incompleteRequirements,
      technicalConcerns: output.technicalConcerns,
      feedbackForNextWeek: output.feedbackForNextWeek,
      confidence: { level, uncertainties },
      reviewScope,
    },
  };
}
