// Live test against the real Supabase project. Skipped unless SUPABASE_URL and
// SUPABASE_SECRET_KEY are set (e.g. in .env.local) and migration 0001 has been run.
import { afterAll, describe, expect, it } from "vitest";
import { getSupabase } from "@/lib/db/supabase";
import { createProject, getProject, listProjects } from "./repository";

const configured = Boolean(
  process.env.SUPABASE_URL && process.env.SUPABASE_SECRET_KEY,
);
const createdIds: string[] = [];

describe.skipIf(!configured)("projects repository (live Supabase)", () => {
  afterAll(async () => {
    if (createdIds.length) {
      await getSupabase().from("projects").delete().in("id", createdIds);
    }
  });

  it("persists, retrieves and lists a project", async () => {
    const created = await createProject({
      title: "Live persistence test",
      description: "Created by the automated live test; safe to delete.",
      repoUrl: "https://github.com/octocat/hello-world",
      durationWeeks: 12,
    });
    createdIds.push(created.id);

    const fetched = await getProject(created.id);
    expect(fetched).toEqual(created);
    expect((await listProjects()).some((p) => p.id === created.id)).toBe(true);
  });

  it("returns null for an unknown id", async () => {
    expect(
      await getProject("00000000-0000-4000-8000-000000000000"),
    ).toBeNull();
  });

  it("rejects values that violate DB constraints", async () => {
    await expect(
      createProject({
        title: "x",
        description: "too short",
        repoUrl: "https://github.com/octocat/hello-world",
        durationWeeks: 12,
      }),
    ).rejects.toMatchObject({ code: "db_error" });
  });
});
