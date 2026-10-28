// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const grading = vi.hoisted(() => ({
  decideSubmission: vi.fn(),
}));
const submissions = vi.hoisted(() => ({ getFacultySubmission: vi.fn() }));
const workflow = vi.hoisted(() => ({ runner: { start: vi.fn(), resumeAfterDecision: vi.fn(async () => {}) } }));
vi.mock("@/lib/grading/repository", async (importOriginal) => {
  // The real DecisionError class, with the database calls replaced.
  const original = await importOriginal<typeof import("@/lib/grading/repository")>().catch(() => null);
  return { ...(original ?? {}), ...grading };
});
vi.mock("@/lib/submissions/repository", () => submissions);
vi.mock("@/lib/workflow/submission", () => ({ getSubmissionRunner: () => workflow.runner }));
vi.mock("@/lib/db/supabase", () => ({ getSupabase: vi.fn(), StorageConfigError: class StorageConfigError extends Error {} }));

import { POST as GRADE } from "@/app/api/faculty/submissions/[id]/grade/route";
import { DecisionError } from "@/lib/grading/repository";
import { POST } from "./route";

const S = "223e4567-e89b-42d3-a456-426614174000";
const ctx = (id: string) => ({ params: Promise.resolve({ id }) }) as never;
const send = (body: unknown, id = S) =>
  POST(new Request("http://localhost", { method: "POST", headers: { "Content-Type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body) }), ctx(id));
const decided = { id: S, status: "approved" };

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  grading.decideSubmission.mockResolvedValue({});
  submissions.getFacultySubmission.mockResolvedValue(decided);
});

describe("POST /api/faculty/submissions/[id]/decision", () => {
  it("approve sends only the choice and returns the updated submission", async () => {
    const res = await send({ decision: "approve", scores: [{ number: 1, marks: 99 }], finalTotal: 100, feedback: "ignored" });
    expect(res.status).toBe(200);
    expect((await res.json()).submission).toEqual(decided);
    expect(grading.decideSubmission).toHaveBeenCalledWith(S, { decision: "approve" });
  });

  it("reject sends only the choice", async () => {
    await send({ decision: "reject" });
    expect(grading.decideSubmission).toHaveBeenCalledWith(S, { decision: "reject" });
  });

  it("edit passes the marks, feedback and comment, and never a total", async () => {
    await send({ decision: "edit", scores: [{ number: 1, marks: 3 }], feedback: " Better ", comment: " Why ", finalTotal: 100 });
    expect(grading.decideSubmission).toHaveBeenCalledWith(S, { decision: "edit", scores: [{ number: 1, marks: 3 }], feedback: "Better", comment: "Why" });
  });

  it("an edit without feedback or comment is refused with the fields named, before the database is touched", async () => {
    const res = await send({ decision: "edit", scores: [{ number: 1, marks: 3 }] });
    expect(res.status).toBe(400);
    const { error } = await res.json();
    expect(Object.keys(error.fields).sort()).toEqual(["comment", "feedback"]);
    expect(grading.decideSubmission).not.toHaveBeenCalled();
  });

  it("refuses an unknown decision, bad JSON and a bad id", async () => {
    expect((await send({ decision: "publish" })).status).toBe(400);
    expect((await send("{nope")).status).toBe(400);
    expect((await send({ decision: "approve" }, "not-a-uuid")).status).toBe(400);
    expect(grading.decideSubmission).not.toHaveBeenCalled();
  });

  it("maps decision problems: already decided and not awaiting review are 409, not found is 404, invalid is 400", async () => {
    const cases: Array<[ConstructorParameters<typeof DecisionError>[0], number]> = [
      ["already_decided", 409],
      ["not_awaiting_review", 409],
      ["not_found", 404],
      ["invalid", 400],
    ];
    for (const [code, status] of cases) {
      grading.decideSubmission.mockRejectedValueOnce(new DecisionError(code, "message"));
      const res = await send({ decision: "approve" });
      expect(res.status).toBe(status);
      expect((await res.json()).error.message).toBe("message");
    }
  });
});

describe("the decision wakes the paused workflow", () => {
  it("after the database function made the decision, and a failure to wake it changes nothing", async () => {
    workflow.runner.resumeAfterDecision.mockRejectedValueOnce(new Error("lease held"));
    const res = await send({ decision: "approve" });
    expect(res.status).toBe(200);
    expect(grading.decideSubmission).toHaveBeenCalledTimes(1);
    expect(workflow.runner.resumeAfterDecision).toHaveBeenCalledWith(S);
  });

  it("is not woken when the decision itself was refused", async () => {
    grading.decideSubmission.mockRejectedValueOnce(new DecisionError("already_decided", "final"));
    expect((await send({ decision: "approve" })).status).toBe(409);
    expect(workflow.runner.resumeAfterDecision).not.toHaveBeenCalled();
  });
});

describe("POST /api/faculty/submissions/[id]/grade", () => {
  const grade = (id = S) => GRADE(new Request("http://localhost", { method: "POST" }), ctx(id));

  it("runs the marking workflow and returns the updated submission", async () => {
    workflow.runner.start.mockResolvedValue({ outcome: "running" });
    const res = await grade();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ outcome: "graded", submission: decided });
    expect(workflow.runner.start).toHaveBeenCalledWith(S);
  });

  it("a failed marking still returns the submission, which now shows the failure", async () => {
    workflow.runner.start.mockResolvedValue({ outcome: "failed" });
    const res = await grade();
    expect(res.status).toBe(200);
    expect((await res.json()).outcome).toBe("failed");
  });

  it("refuses a submission that is not ready for marking", async () => {
    workflow.runner.start.mockResolvedValue({ outcome: "skipped" });
    const res = await grade();
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("not_ready");
  });

  it("is 409 while the same submission is already being run, and 400 for a bad id", async () => {
    const { LeaseHeldError } = await import("@/lib/workflow/lease");
    workflow.runner.start.mockRejectedValue(new LeaseHeldError());
    const res = await grade();
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("already_running");
    expect((await grade("nope")).status).toBe(400);
  });
});
