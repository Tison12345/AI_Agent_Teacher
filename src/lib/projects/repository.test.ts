import { beforeEach, describe, expect, it, vi } from "vitest";

const calls: Record<string, unknown[]> = {};
let result: { data: unknown; error: { message: string } | null } = {
  data: null,
  error: null,
};

function chain() {
  const c = {
    insert: vi.fn((v: unknown) => ((calls.insert = [v]), c)),
    select: vi.fn(() => c),
    eq: vi.fn((...a: unknown[]) => ((calls.eq = a), c)),
    order: vi.fn(async () => result),
    single: vi.fn(async () => result),
    maybeSingle: vi.fn(async () => result),
  };
  return c;
}

vi.mock("@/lib/db/supabase", () => ({
  getSupabase: () => ({ from: () => chain() }),
}));

import { createProject, getProject, listProjects } from "./repository";

const row = {
  id: "123e4567-e89b-42d3-a456-426614174000",
  title: "Smart Attendance",
  description: "A system that marks attendance using faces.",
  repo_url: "https://github.com/octocat/hello-world",
  duration_weeks: 12,
  created_at: "2026-10-25T12:00:00+00:00",
};

beforeEach(() => {
  for (const k of Object.keys(calls)) delete calls[k];
  result = { data: null, error: null };
});

describe("projects repository", () => {
  it("creates a project, mapping to snake_case and back", async () => {
    result = { data: row, error: null };
    const project = await createProject({
      title: row.title,
      description: row.description,
      repoUrl: row.repo_url,
      durationWeeks: 12,
    });
    expect(calls.insert[0]).toEqual({
      title: row.title,
      description: row.description,
      repo_url: row.repo_url,
      duration_weeks: 12,
    });
    expect(project).toMatchObject({ id: row.id, repoUrl: row.repo_url, durationWeeks: 12 });
  });

  it("lists projects (empty list is fine)", async () => {
    result = { data: [], error: null };
    expect(await listProjects()).toEqual([]);
    result = { data: [row], error: null };
    expect(await listProjects()).toHaveLength(1);
  });

  it("returns null when a project is missing", async () => {
    result = { data: null, error: null };
    expect(await getProject(row.id)).toBeNull();
  });

  it("gets a project by id", async () => {
    result = { data: row, error: null };
    expect((await getProject(row.id))?.title).toBe(row.title);
    expect(calls.eq).toEqual(["id", row.id]);
  });

  it("throws db_error when the database fails", async () => {
    result = { data: null, error: { message: "connection refused" } };
    await expect(listProjects()).rejects.toMatchObject({ code: "db_error" });
  });

  it("throws invalid_data for rows that fail validation", async () => {
    result = { data: { ...row, duration_weeks: 99 }, error: null };
    await expect(getProject(row.id)).rejects.toMatchObject({ code: "invalid_data" });
    result = { data: { ...row, duration_weeks: 0 }, error: null };
    await expect(getProject(row.id)).rejects.toMatchObject({ code: "invalid_data" });
    result = { data: { nonsense: true }, error: null };
    await expect(getProject(row.id)).rejects.toMatchObject({ code: "invalid_data" });
  });
});
