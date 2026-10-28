import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { notStartedProgress, type WorkflowProgress as Progress } from "@/lib/workflow/submission/progress";

const api = vi.hoisted(() => ({ fetchWorkflowProgress: vi.fn(), resumeSubmissionWorkflow: vi.fn(), resumeEvaluationWorkflow: vi.fn(), fetchEvaluationProgress: vi.fn() }));
vi.mock("@/lib/api/client", () => api);

import { RUNNING_POLL_MS, WAITING_POLL_MS, WorkflowProgress } from "./WorkflowProgress";

const S = "223e4567-e89b-42d3-a456-426614174000";
const progress = (state: Progress["state"] | "stalled", statuses: Record<string, Progress["steps"][number]["status"]> = {}, failure: Progress["failure"] = null): Progress => {
  const base = notStartedProgress();
  return { state, failure, steps: base.steps.map((step) => ({ ...step, status: statuses[step.id] ?? step.status })) };
};
const tick = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
});
afterEach(() => vi.useRealTimers());

describe("WorkflowProgress", () => {
  it("shows each step with its real status", async () => {
    api.fetchWorkflowProgress.mockResolvedValue(progress("running", { extract_text: "done", check_readable: "done", grade: "active" }));
    render(<WorkflowProgress submissionId={S} />);
    await tick(0);
    expect(screen.getByRole("status", { name: "" })).toBeInTheDocument();
    const grade = document.querySelector('[data-step="grade"]');
    expect(grade).toHaveAttribute("data-status", "active");
    expect(document.querySelector('[data-step="extract_text"]')).toHaveAttribute("data-status", "done");
    expect(screen.getByText("AI marking")).toBeInTheDocument();
  });

  it("looks again every 2 seconds while the workflow works", async () => {
    api.fetchWorkflowProgress.mockResolvedValue(progress("running"));
    render(<WorkflowProgress submissionId={S} />);
    await tick(0);
    expect(api.fetchWorkflowProgress).toHaveBeenCalledTimes(1);
    await tick(RUNNING_POLL_MS);
    expect(api.fetchWorkflowProgress).toHaveBeenCalledTimes(2);
    await tick(RUNNING_POLL_MS);
    expect(api.fetchWorkflowProgress).toHaveBeenCalledTimes(3);
  });

  it("looks less often while waiting for faculty, and tells the page when the state changes", async () => {
    const onStateChange = vi.fn();
    api.fetchWorkflowProgress.mockResolvedValueOnce(progress("running")).mockResolvedValue(progress("waiting_faculty", { await_faculty: "waiting" }));
    render(<WorkflowProgress submissionId={S} onStateChange={onStateChange} />);
    await tick(0);
    await tick(RUNNING_POLL_MS);
    expect(onStateChange).toHaveBeenCalledWith("waiting_faculty");
    expect(screen.getByText(/waiting for a teacher to review/i)).toBeInTheDocument();
    const calls = api.fetchWorkflowProgress.mock.calls.length;
    await tick(RUNNING_POLL_MS * 2);
    expect(api.fetchWorkflowProgress).toHaveBeenCalledTimes(calls); // not at the fast rate any more
    await tick(WAITING_POLL_MS);
    expect(api.fetchWorkflowProgress).toHaveBeenCalledTimes(calls + 1);
  });

  it("stops looking once the workflow has ended, and shows the fixed failure sentence", async () => {
    api.fetchWorkflowProgress.mockResolvedValue(
      progress("failed", { extract_text: "done", check_readable: "done", grade: "failed", check_grade: "skipped" }, { code: "marking_unavailable", message: "The AI marking service could not be reached." }),
    );
    render(<WorkflowProgress submissionId={S} />);
    await tick(0);
    expect(screen.getByRole("alert")).toHaveTextContent("The AI marking service could not be reached.");
    await tick(WAITING_POLL_MS * 3);
    expect(api.fetchWorkflowProgress).toHaveBeenCalledTimes(1);
  });

  it("keeps trying after a failed request, and stops when removed", async () => {
    api.fetchWorkflowProgress.mockRejectedValueOnce(new Error("offline")).mockResolvedValue(progress("running"));
    const { unmount } = render(<WorkflowProgress submissionId={S} />);
    await tick(0);
    expect(screen.getByRole("alert")).toHaveTextContent("offline");
    await tick(RUNNING_POLL_MS);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    unmount();
    const calls = api.fetchWorkflowProgress.mock.calls.length;
    await tick(RUNNING_POLL_MS * 3);
    expect(api.fetchWorkflowProgress).toHaveBeenCalledTimes(calls);
  });

  it("a stalled run offers Continue, which asks the server to continue it and shows the run as running again", async () => {
    api.fetchWorkflowProgress.mockResolvedValue(progress("stalled", { extract_text: "done", grade: "active" } as never));
    api.resumeSubmissionWorkflow.mockResolvedValue({ ok: true });
    render(<WorkflowProgress submissionId={S} />);
    await tick(0);
    expect(screen.getByText(/stopped before it finished/i)).toBeInTheDocument();
    await act(async () => {
      screen.getByRole("button", { name: "Continue" }).click();
    });
    expect(api.resumeSubmissionWorkflow).toHaveBeenCalledWith(S);
    expect(screen.queryByRole("button", { name: "Continue" })).not.toBeInTheDocument();
  });

  it("says so when Continue is refused, and offers it again", async () => {
    api.fetchWorkflowProgress.mockResolvedValue(progress("stalled"));
    api.resumeSubmissionWorkflow.mockResolvedValue({ ok: false, message: "This submission's workflow is not stalled." });
    render(<WorkflowProgress submissionId={S} />);
    await tick(0);
    await act(async () => {
      screen.getByRole("button", { name: "Continue" }).click();
    });
    expect(screen.getByRole("alert")).toHaveTextContent("not stalled");
    expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled();
  });

  it("a run that is not stalled has no Continue button", async () => {
    api.fetchWorkflowProgress.mockResolvedValue(progress("running"));
    render(<WorkflowProgress submissionId={S} />);
    await tick(0);
    expect(screen.queryByRole("button", { name: "Continue" })).not.toBeInTheDocument();
  });
});
