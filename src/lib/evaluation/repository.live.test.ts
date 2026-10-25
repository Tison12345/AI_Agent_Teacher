// Live test against the real Supabase project (opt-in: npm run test:live).
// Needs SUPABASE_URL and SUPABASE_SECRET_KEY, and migrations 0003 and 0004 applied.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkpointStore } from "@/lib/checkpoints/repository";
import { getSupabase } from "@/lib/db/supabase";
import { createProject } from "@/lib/projects/repository";
import { evaluationStore } from "./repository";
import { EvaluationConflictError } from "./service";
import { STRONG, modelAnswer } from "./fixtures";
import { assembleEvaluation } from "./assemble";
import { WEEK } from "./fixtures";

const configured = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SECRET_KEY);
const sha = (c: string) => c.repeat(40);

describe.skipIf(!configured)("evaluation store (live Supabase)", () => {
  let projectId = "";
  let checkpointId = "";

  const result = () => {
    const assembled = assembleEvaluation(modelAnswer([36, 30, 28]), { criteria: WEEK.evaluationCriteria, snapshot: STRONG });
    if (!assembled.ok) throw new Error("fixture should be valid");
    return assembled.value;
  };

  beforeAll(async () => {
    const project = await createProject({
      title: "Live evaluation test",
      description: "Created by the automated live test; safe to delete.",
      repoUrl: "https://github.com/octocat/hello-world",
      durationWeeks: 12,
    });
    projectId = project.id;
    const checkpoint = await checkpointStore.insertCheckpoint({
      projectId,
      weekNumber: 1,
      commitSha: sha("1"),
      baseCommitSha: sha("0"),
      branch: "main",
      filesChanged: 2,
      additions: 20,
      deletions: 0,
    });
    checkpointId = checkpoint.id;
  });

  afterAll(async () => {
    if (projectId) await getSupabase().from("projects").delete().eq("id", projectId); // cascades
  });

  it("stores an evaluation with its snapshot and reads it back unchanged", async () => {
    expect(await evaluationStore.getByCheckpoint(checkpointId)).toBeNull();
    const stored = await evaluationStore.insert({
      projectId,
      checkpointId,
      weekNumber: 1,
      result: result(),
      snapshot: STRONG,
      model: "live-test-model",
    });
    expect(stored.evaluation).toMatchObject({ suggestedScore: 94, status: "pending_review", model: "live-test-model" });
    expect(stored.snapshot.files[0].patch).toContain("function addBook");

    const again = await evaluationStore.getByCheckpoint(checkpointId);
    expect(again).toEqual(stored);
    expect(await evaluationStore.listStatuses(projectId)).toEqual([{ weekNumber: 1, status: "pending_review" }]);
  });

  it("allows only one evaluation per checkpoint", async () => {
    await expect(
      evaluationStore.insert({ projectId, checkpointId, weekNumber: 1, result: result(), snapshot: STRONG, model: "other" }),
    ).rejects.toBeInstanceOf(EvaluationConflictError);
    expect((await evaluationStore.getByCheckpoint(checkpointId))?.evaluation.model).toBe("live-test-model");
  });

  it("the database refuses to rewrite the AI's output, but allows the status to change", async () => {
    const db = getSupabase();
    const score = await db.from("evaluations").update({ suggested_score: 100 }).eq("checkpoint_id", checkpointId);
    expect(score.error?.message).toMatch(/immutable/);
    const body = await db.from("evaluations").update({ result: {} }).eq("checkpoint_id", checkpointId);
    expect(body.error?.message).toMatch(/immutable/);
    const snapshot = await db.from("evaluations").update({ snapshot: {} }).eq("checkpoint_id", checkpointId);
    expect(snapshot.error?.message).toMatch(/immutable/);
    expect((await evaluationStore.getByCheckpoint(checkpointId))?.evaluation.suggestedScore).toBe(94);

    // Only the review status may change (used by the teacher workflow later).
    const status = await db.from("evaluations").update({ status: "approved" }).eq("checkpoint_id", checkpointId);
    expect(status.error).toBeNull();
    expect((await evaluationStore.getByCheckpoint(checkpointId))?.evaluation.status).toBe("approved");
    const bad = await db.from("evaluations").update({ status: "maybe" }).eq("checkpoint_id", checkpointId);
    expect(bad.error).not.toBeNull();
  });

  it("rejects out-of-range scores at the database", async () => {
    const week2 = await checkpointStore.insertCheckpoint({
      projectId,
      weekNumber: 2,
      commitSha: sha("2"),
      baseCommitSha: sha("1"),
      branch: "main",
      filesChanged: 1,
      additions: 1,
      deletions: 0,
    });
    const r = await getSupabase().from("evaluations").insert({
      project_id: projectId,
      checkpoint_id: week2.id,
      week_number: 2,
      suggested_score: 150,
      result: {},
      snapshot: {},
      model: "x",
    });
    expect(r.error).not.toBeNull();
  });
});
