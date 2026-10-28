// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const repo = vi.hoisted(() => ({ listStudents: vi.fn(), getStudent: vi.fn() }));
vi.mock("@/lib/students/repository", () => repo);
vi.mock("@/lib/db/supabase", () => ({ StorageConfigError: class StorageConfigError extends Error {} }));

import { GET as list } from "./route";
import { GET as one } from "./[id]/route";

const ASHA = "11111111-1111-4111-8111-111111111111";
const ctx = (id: string) => ({ params: Promise.resolve({ id }) }) as never;

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("GET /api/faculty/students", () => {
  it("returns the overview and the students, never cached", async () => {
    const data = { overview: { totalStudents: 1 }, students: [{ id: ASHA, name: "Asha Fictional" }] };
    repo.listStudents.mockResolvedValue(data);
    const res = await list();
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.json()).toEqual(data);
  });

  it("an unexpected failure is a plain server error without details", async () => {
    repo.listStudents.mockRejectedValue(new Error("connect ECONNREFUSED secret-host:5432 password=hunter2"));
    const res = await list();
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toMatch(/hunter2|ECONNREFUSED/);
  });
});

describe("GET /api/faculty/students/[id]", () => {
  it("returns one student", async () => {
    repo.getStudent.mockResolvedValue({ summary: { id: ASHA } });
    const res = await one(new Request("http://localhost"), ctx(ASHA));
    expect(res.status).toBe(200);
    expect((await res.json()).student.summary.id).toBe(ASHA);
    expect(repo.getStudent).toHaveBeenCalledWith(ASHA);
  });

  it("accepts the unassigned group", async () => {
    repo.getStudent.mockResolvedValue({ summary: { id: "unassigned" } });
    expect((await one(new Request("http://localhost"), ctx("unassigned"))).status).toBe(200);
    expect(repo.getStudent).toHaveBeenCalledWith("unassigned");
  });

  it("404 for a student that does not exist, 400 for an id that is not one, without reading anything", async () => {
    repo.getStudent.mockResolvedValue(null);
    expect((await one(new Request("http://localhost"), ctx(ASHA))).status).toBe(404);
    repo.getStudent.mockClear();
    expect((await one(new Request("http://localhost"), ctx("not-a-uuid"))).status).toBe(400);
    expect(repo.getStudent).not.toHaveBeenCalled();
  });
});
