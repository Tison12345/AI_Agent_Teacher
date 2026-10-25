import { beforeEach, describe, expect, it, vi } from "vitest";
import { StorageConfigError } from "@/lib/db/supabase";

const repo = vi.hoisted(() => ({
  createProject: vi.fn(),
  listProjects: vi.fn(),
  getProject: vi.fn(),
}));
vi.mock("@/lib/projects/repository", () => repo);
vi.mock("@/lib/db/supabase", () => ({
  StorageConfigError: class StorageConfigError extends Error {},
}));

import { GET, POST } from "./route";
import { GET as GET_ONE } from "./[id]/route";

const project = {
  id: "123e4567-e89b-42d3-a456-426614174000",
  title: "Smart Attendance",
  description: "A system that marks attendance using faces.",
  repoUrl: "https://github.com/octocat/hello-world",
  durationWeeks: 12,
  createdAt: "2026-10-25T12:00:00+00:00",
};

const post = (body: unknown) =>
  POST(
    new Request("http://localhost/api/projects", {
      method: "POST",
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("POST /api/projects", () => {
  const base = {
    title: "Smart Attendance",
    description: "A system that marks attendance using faces.",
    repoUrl: "https://github.com/octocat/hello-world",
  };

  it("creates a project with the chosen duration", async () => {
    repo.createProject.mockResolvedValue({ ...project, durationWeeks: 4 });
    const res = await post({ ...base, durationWeeks: 4 });
    expect(res.status).toBe(201);
    expect(repo.createProject).toHaveBeenCalledWith(expect.objectContaining({ durationWeeks: 4 }));
    expect((await res.json()).project.durationWeeks).toBe(4);
  });

  it("uses 12 weeks when no duration is given", async () => {
    repo.createProject.mockResolvedValue(project);
    expect((await post(base)).status).toBe(201);
    expect(repo.createProject).toHaveBeenCalledWith(expect.objectContaining({ durationWeeks: 12 }));
  });

  it.each([0, 17, 99, -1, 1.5, "8", null, true])("rejects a duration of %j and creates nothing", async (durationWeeks) => {
    const res = await post({ ...base, durationWeeks });
    expect(res.status).toBe(400);
    const { error } = await res.json();
    expect(Object.keys(error.fields)).toEqual(["durationWeeks"]);
    expect(repo.createProject).not.toHaveBeenCalled();
  });

  it("rejects invalid input on the server with field errors", async () => {
    const res = await post({ title: "", description: "short", repoUrl: "https://evil.com/a/b" });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(Object.keys(body.error.fields).sort()).toEqual(["description", "repoUrl", "title"]);
    expect(repo.createProject).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON and non-object bodies", async () => {
    expect((await post("{not json")).status).toBe(400);
    expect((await post("null")).status).toBe(400);
    expect((await post("[]")).status).toBe(400);
  });

  it("does not leak database errors", async () => {
    repo.createProject.mockRejectedValue(new Error("password=secret host=db"));
    const res = await post({
      title: "Smart Attendance",
      description: "A system that marks attendance using faces.",
      repoUrl: "https://github.com/octocat/hello-world",
    });
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toMatch(/secret/);
  });
});

describe("GET /api/projects", () => {
  it("returns projects", async () => {
    repo.listProjects.mockResolvedValue([project]);
    const res = await GET();
    expect(res.status).toBe(200);
    expect((await res.json()).projects).toHaveLength(1);
  });

  it("returns 503 when storage is not configured", async () => {
    repo.listProjects.mockRejectedValue(new StorageConfigError());
    const res = await GET();
    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe("storage_unavailable");
  });
});

describe("GET /api/projects/[id]", () => {
  const call = (id: string) =>
    GET_ONE(new Request("http://localhost/api/projects/x"), {
      params: Promise.resolve({ id }),
    } as never);

  it("returns 400 for a non-UUID id without touching the database", async () => {
    expect((await call("1; drop table projects")).status).toBe(400);
    expect(repo.getProject).not.toHaveBeenCalled();
  });

  it("returns 404 when missing and 200 when found", async () => {
    repo.getProject.mockResolvedValueOnce(null);
    expect((await call(project.id)).status).toBe(404);
    repo.getProject.mockResolvedValueOnce(project);
    const res = await call(project.id);
    expect(res.status).toBe(200);
    expect((await res.json()).project.title).toBe(project.title);
  });
});
