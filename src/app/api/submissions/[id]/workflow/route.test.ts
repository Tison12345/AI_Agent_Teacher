// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const submissions = vi.hoisted(() => ({ getStudentSubmission: vi.fn() }));
const runner = vi.hoisted(() => ({ progress: vi.fn() }));
vi.mock("@/lib/submissions/repository", () => submissions);
const resume = vi.hoisted(() => ({ resumeInBackground: vi.fn() }));
vi.mock("@/lib/workflow/submission", () => ({ getSubmissionRunner: () => runner, ...resume }));

import { GET, POST } from "./route";

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

describe("POST /api/submissions/[id]/workflow (continue a stalled run)", () => {
  const post = (id = S) => POST(new Request("http://localhost", { method: "POST" }), ctx(id));

  it("continues a stalled run in the background (202)", async () => {
    runner.progress.mockResolvedValue({ state: "stalled", steps: [], failure: null });
    const res = await post();
    expect(res.status).toBe(202);
    expect(resume.resumeInBackground).toHaveBeenCalledWith(S);
  });

  it.each(["running", "waiting_faculty", "complete", "failed", "needs_ocr", "not_started"])("leaves a %s run alone (409)", async (state) => {
    runner.progress.mockResolvedValue({ state, steps: [], failure: null });
    const res = await post();
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("not_stalled");
    expect(resume.resumeInBackground).not.toHaveBeenCalled();
  });

  it("is 404 for an unknown submission and 400 for a bad id", async () => {
    submissions.getStudentSubmission.mockResolvedValue(null);
    expect((await post()).status).toBe(404);
    expect((await post("nope")).status).toBe(400);
    expect(resume.resumeInBackground).not.toHaveBeenCalled();
  });
});
