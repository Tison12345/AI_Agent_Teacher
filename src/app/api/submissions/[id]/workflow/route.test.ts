// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const submissions = vi.hoisted(() => ({ getStudentSubmission: vi.fn() }));
const runner = vi.hoisted(() => ({ progress: vi.fn() }));
vi.mock("@/lib/submissions/repository", () => submissions);
vi.mock("@/lib/workflow/submission", () => ({ getSubmissionRunner: () => runner }));

import { GET } from "./route";

const S = "223e4567-e89b-42d3-a456-426614174000";
const ctx = (id: string) => ({ params: Promise.resolve({ id }) }) as never;
const get = (id = S) => GET(new Request("http://localhost"), ctx(id));

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  submissions.getStudentSubmission.mockResolvedValue({ id: S });
});

describe("GET /api/submissions/[id]/workflow", () => {
  it("returns the progress, never cached", async () => {
    const progress = { state: "running", steps: [], failure: null };
    runner.progress.mockResolvedValue(progress);
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.json()).toEqual({ progress });
    expect(runner.progress).toHaveBeenCalledWith(S);
  });

  it("is 404 for a submission that does not exist, and does not read any checkpoint", async () => {
    submissions.getStudentSubmission.mockResolvedValue(null);
    expect((await get()).status).toBe(404);
    expect(runner.progress).not.toHaveBeenCalled();
  });

  it("is 400 for a bad id", async () => {
    expect((await get("nope")).status).toBe(400);
  });

  it("an unexpected failure is a plain server error with no details", async () => {
    runner.progress.mockRejectedValue(new Error("connect ECONNREFUSED secret-host:5432 password=hunter2"));
    const res = await get();
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toMatch(/hunter2|ECONNREFUSED|secret-host/);
  });
});
