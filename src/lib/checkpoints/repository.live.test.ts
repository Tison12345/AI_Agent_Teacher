// Live test against the real Supabase project. Skipped unless SUPABASE_URL and
// SUPABASE_SECRET_KEY are set and migration 0003 has been run.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getSupabase } from "@/lib/db/supabase";
import { createProject } from "@/lib/projects/repository";
import { checkpointStore } from "./repository";
import { StoreConflictError } from "./service";

const configured = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SECRET_KEY);
const sha = (c: string) => c.repeat(40);

describe.skipIf(!configured)("checkpoint store (live Supabase)", () => {
  let projectId = "";

  beforeAll(async () => {
    const project = await createProject({
      title: "Live checkpoint test",
      description: "Created by the automated live test; safe to delete.",
      repoUrl: "https://github.com/octocat/hello-world",
      durationWeeks: 12,
    });
    projectId = project.id;
  });

  afterAll(async () => {
    if (projectId) await getSupabase().from("projects").delete().eq("id", projectId); // cascades
  });

  it("stores and reads a baseline; a second baseline conflicts and changes nothing", async () => {
    expect(await checkpointStore.getBaseline(projectId)).toBeNull();
    const baseline = await checkpointStore.insertBaseline({ projectId, commitSha: sha("a"), branch: "main" });
    expect(baseline.commitSha).toBe(sha("a"));
    await expect(
      checkpointStore.insertBaseline({ projectId, commitSha: sha("b"), branch: "main" }),
    ).rejects.toBeInstanceOf(StoreConflictError);
    expect((await checkpointStore.getBaseline(projectId))?.commitSha).toBe(sha("a"));
  });

  it("stores checkpoints in week order; a duplicate week conflicts and keeps the original", async () => {
    const base = { projectId, branch: "main", filesChanged: 3, additions: 10, deletions: 2 };
    await checkpointStore.insertCheckpoint({ ...base, weekNumber: 2, commitSha: sha("2"), baseCommitSha: sha("1") });
    await checkpointStore.insertCheckpoint({ ...base, weekNumber: 1, commitSha: sha("1"), baseCommitSha: sha("a") });
    await expect(
      checkpointStore.insertCheckpoint({ ...base, weekNumber: 1, commitSha: sha("f"), baseCommitSha: sha("a") }),
    ).rejects.toBeInstanceOf(StoreConflictError);

    const list = await checkpointStore.listCheckpoints(projectId);
    expect(list.map((c) => c.weekNumber)).toEqual([1, 2]);
    expect((await checkpointStore.getCheckpoint(projectId, 1))?.commitSha).toBe(sha("1"));
    expect(await checkpointStore.getCheckpoint(projectId, 3)).toBeNull();
  });

  it("the database itself refuses to edit a recorded checkpoint or baseline", async () => {
    const db = getSupabase();
    const edit = await db.from("weekly_checkpoints").update({ commit_sha: sha("9") }).eq("project_id", projectId).eq("week_number", 1);
    expect(edit.error?.message).toMatch(/immutable/);
    const editBaseline = await db.from("project_baselines").update({ commit_sha: sha("9") }).eq("project_id", projectId);
    expect(editBaseline.error?.message).toMatch(/immutable/);
    expect((await checkpointStore.getCheckpoint(projectId, 1))?.commitSha).toBe(sha("1"));
    expect((await checkpointStore.getBaseline(projectId))?.commitSha).toBe(sha("a"));
  });

  it("rejects malformed SHAs and out-of-range weeks at the database", async () => {
    const base = { projectId, branch: "main", filesChanged: 0, additions: 0, deletions: 0 };
    await expect(
      checkpointStore.insertCheckpoint({ ...base, weekNumber: 5, commitSha: "not-a-sha", baseCommitSha: sha("1") }),
    ).rejects.toMatchObject({ code: "db_error" });
    await expect(
      checkpointStore.insertCheckpoint({ ...base, weekNumber: 17, commitSha: sha("1"), baseCommitSha: sha("1") }),
    ).rejects.toMatchObject({ code: "db_error" });
    await expect(
      checkpointStore.insertCheckpoint({ ...base, weekNumber: 0, commitSha: sha("1"), baseCommitSha: sha("1") }),
    ).rejects.toMatchObject({ code: "db_error" });
  });

  // Needs migration 0006_variable_duration.sql: weeks up to 16 are allowed now.
  it("accepts a checkpoint for week 16 (longer projects)", async () => {
    const base = { projectId, branch: "main", filesChanged: 1, additions: 1, deletions: 0 };
    const stored = await checkpointStore.insertCheckpoint({ ...base, weekNumber: 16, commitSha: sha("c"), baseCommitSha: sha("b") });
    expect(stored.weekNumber).toBe(16);
  });
});
