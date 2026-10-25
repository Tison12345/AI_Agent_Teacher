// Live test against the real Supabase project (opt-in: npm run test:live).
// Needs SUPABASE_URL and SUPABASE_SECRET_KEY, and migrations 0003, 0004 and 0005 applied.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkpointStore } from "@/lib/checkpoints/repository";
import { getSupabase } from "@/lib/db/supabase";
import { assembleEvaluation } from "@/lib/evaluation/assemble";
import { evaluationStore } from "@/lib/evaluation/repository";
import { STRONG, WEEK, modelAnswer } from "@/lib/evaluation/fixtures";
import { createProject } from "@/lib/projects/repository";
import { DecisionRequestSchema } from "@/lib/schemas/review";
import { reviewStore } from "./repository";
import { submitDecision } from "./service";

const configured = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SECRET_KEY);
const sha = (c: string) => c.repeat(40);

describe.skipIf(!configured)("review store (live Supabase)", () => {
  let projectId = "";
  const evaluationIds: string[] = [];

  async function addEvaluation(weekNumber: number) {
    const checkpoint = await checkpointStore.insertCheckpoint({
      projectId,
      weekNumber,
      commitSha: sha(String(weekNumber)),
      baseCommitSha: sha(String(weekNumber - 1)),
      branch: "main",
      filesChanged: 2,
      additions: 20,
      deletions: 0,
    });
    const assembled = assembleEvaluation(modelAnswer([36, 30, 28]), { criteria: WEEK.evaluationCriteria, snapshot: STRONG });
    if (!assembled.ok) throw new Error("fixture should be valid");
    const stored = await evaluationStore.insert({
      projectId,
      checkpointId: checkpoint.id,
      weekNumber,
      result: assembled.value,
      snapshot: STRONG,
      model: "live-test-model",
    });
    evaluationIds.push(stored.evaluation.id);
    return stored.evaluation;
  }

  beforeAll(async () => {
    const project = await createProject({
      title: "Live review test",
      description: "Created by the automated live test; safe to delete.",
      repoUrl: "https://github.com/octocat/hello-world",
      durationWeeks: 12,
    });
    projectId = project.id;
  });

  afterAll(async () => {
    if (projectId) await getSupabase().from("projects").delete().eq("id", projectId); // cascades
  });

  it("lists pending evaluations with project title and confidence, and reads full detail back", async () => {
    const evaluation = await addEvaluation(1);
    const queue = await reviewStore.list("pending_review");
    const mine = queue.find((q) => q.evaluationId === evaluation.id);
    expect(mine).toMatchObject({ projectTitle: "Live review test", weekNumber: 1, suggestedScore: 94, confidence: "high", status: "pending_review" });

    const detail = await reviewStore.getDetail(evaluation.id);
    expect(detail?.project).toMatchObject({ id: projectId, title: "Live review test" });
    expect(detail?.snapshot.files[0].patch).toContain("function addBook");
    expect(detail?.decision).toBeNull();
    expect(await reviewStore.getDetail("00000000-0000-4000-8000-00000000dead")).toBeNull();
  });

  it("approve records the decision and the status together, and students see only the official result", async () => {
    const evaluation = await addEvaluation(2);
    const decision = await submitDecision(
      evaluation.id,
      DecisionRequestSchema.parse({ decision: "approve", comment: "PRIVATE-NOTE" }),
      reviewStore,
    );
    expect(decision).toMatchObject({ decision: "approve", approvedScore: 94, comment: "PRIVATE-NOTE" });
    const detail = await reviewStore.getDetail(evaluation.id);
    expect(detail?.evaluation.status).toBe("approved");
    expect(detail?.decision?.id).toBe(decision.id);
    expect((await evaluationStore.listStatuses(projectId)).find((s) => s.weekNumber === 2)?.status).toBe("approved");

    const results = await reviewStore.listResults(projectId);
    expect(results).toEqual([
      expect.objectContaining({ weekNumber: 2, outcome: "approved", officialScore: 94 }),
    ]);
    expect(JSON.stringify(results)).not.toMatch(/PRIVATE-NOTE|suggested|confidence/);
  });

  it("a decision is final: a second decision is refused and the first stands", async () => {
    const evaluation = await addEvaluation(3);
    await submitDecision(evaluation.id, DecisionRequestSchema.parse({ decision: "reject", comment: "unreliable" }), reviewStore);
    await expect(
      submitDecision(evaluation.id, DecisionRequestSchema.parse({ decision: "approve" }), reviewStore),
    ).rejects.toMatchObject({ code: "already_decided" });
    const detail = await reviewStore.getDetail(evaluation.id);
    expect(detail?.evaluation.status).toBe("rejected");
    expect(detail?.decision).toMatchObject({ decision: "reject", approvedScore: null, approvedFeedback: null });
  });

  it("simultaneous decisions record exactly one", async () => {
    const evaluation = await addEvaluation(4);
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        submitDecision(evaluation.id, DecisionRequestSchema.parse({ decision: "approve" }), reviewStore),
      ),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const { data } = await getSupabase().from("teacher_decisions").select("id").eq("evaluation_id", evaluation.id);
    expect(data).toHaveLength(1);
  });

  it("the database itself refuses to edit a decision, to rewrite a decided status, or to store an inconsistent decision", async () => {
    const db = getSupabase();
    const decided = evaluationIds[1]; // the approved one from the second test

    const edit = await db.from("teacher_decisions").update({ approved_score: 5 }).eq("evaluation_id", decided);
    expect(edit.error?.message).toMatch(/cannot be changed/);

    const status = await db.from("evaluations").update({ status: "rejected" }).eq("id", decided);
    expect(status.error?.message).toMatch(/already decided/);

    const fresh = await addEvaluation(5);
    const rejectWithScore = await db
      .from("teacher_decisions")
      .insert({ evaluation_id: fresh.id, decision: "reject", approved_score: 50 });
    expect(rejectWithScore.error).not.toBeNull();
    const approveWithoutScore = await db
      .from("teacher_decisions")
      .insert({ evaluation_id: fresh.id, decision: "approve", approved_feedback: "x" });
    expect(approveWithoutScore.error).not.toBeNull();
    const outOfRange = await db
      .from("teacher_decisions")
      .insert({ evaluation_id: fresh.id, decision: "edit", approved_score: 150, approved_feedback: "x" });
    expect(outOfRange.error).not.toBeNull();
    expect((await reviewStore.getDetail(fresh.id))?.evaluation.status).toBe("pending_review"); // nothing leaked through
  });
});
