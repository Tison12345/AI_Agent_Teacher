// Live test against the real Supabase project. Skipped unless SUPABASE_URL and
// SUPABASE_SECRET_KEY are set and migration 0007 has been run.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkpointStore } from "@/lib/checkpoints/repository";
import { getSupabase } from "@/lib/db/supabase";
import { createProject } from "@/lib/projects/repository";
import { assembleQuiz } from "./assemble";
import { modelQuiz } from "./fixtures";
import { quizStore } from "./repository";
import { AttemptConflictError, QuizConflictError } from "./service";

const configured = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SECRET_KEY);
const sha = (c: string) => c.repeat(40);

describe.skipIf(!configured)("quiz store (live Supabase)", () => {
  let projectId = "";
  let checkpointId = "";

  const questions = () => {
    const assembled = assembleQuiz(modelQuiz());
    if (!assembled.ok) throw new Error("fixture invalid");
    return assembled.value;
  };

  beforeAll(async () => {
    const project = await createProject({
      title: "Live quiz test",
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
      filesChanged: 1,
      additions: 1,
      deletions: 0,
    });
    checkpointId = checkpoint.id;
  });

  afterAll(async () => {
    if (projectId) await getSupabase().from("projects").delete().eq("id", projectId); // cascades
  });

  it("has no quiz until one is stored; a second quiz for the checkpoint conflicts and changes nothing", async () => {
    expect(await quizStore.getByCheckpoint(checkpointId)).toBeNull();
    const first = await quizStore.insertQuiz({ projectId, checkpointId, weekNumber: 1, questions: questions(), model: "m1" });
    expect(first.questions).toHaveLength(5);
    await expect(
      quizStore.insertQuiz({ projectId, checkpointId, weekNumber: 1, questions: questions(), model: "m2" }),
    ).rejects.toBeInstanceOf(QuizConflictError);
    const stored = await quizStore.getByCheckpoint(checkpointId);
    expect(stored?.quiz.model).toBe("m1");
    expect(stored?.attempt).toBeNull();
  });

  it("stores exactly one attempt per quiz and keeps the first", async () => {
    const quiz = (await quizStore.getByCheckpoint(checkpointId))!.quiz;
    const attempt = await quizStore.insertAttempt({ quizId: quiz.id, answers: [0, 1, 2, 3, 0], correctCount: 2, total: 5 });
    expect(attempt).toMatchObject({ correctCount: 2, total: 5 });
    await expect(
      quizStore.insertAttempt({ quizId: quiz.id, answers: [0, 0, 0, 0, 0], correctCount: 5, total: 5 }),
    ).rejects.toBeInstanceOf(AttemptConflictError);
    const stored = await quizStore.getByCheckpoint(checkpointId);
    expect(stored?.attempt?.answers).toEqual([0, 1, 2, 3, 0]);
    expect(stored?.attempt?.correctCount).toBe(2);
  });

  it("the database itself refuses to edit a saved quiz or attempt", async () => {
    const db = getSupabase();
    const editQuiz = await db.from("quizzes").update({ model: "changed" }).eq("checkpoint_id", checkpointId);
    expect(editQuiz.error?.message).toMatch(/cannot be changed/);
    const editAttempt = await db.from("quiz_attempts").update({ correct_count: 5 }).neq("id", "00000000-0000-0000-0000-000000000000");
    expect(editAttempt.error?.message).toMatch(/cannot be changed/);
    const stored = await quizStore.getByCheckpoint(checkpointId);
    expect(stored?.quiz.model).toBe("m1");
    expect(stored?.attempt?.correctCount).toBe(2);
  });
});
