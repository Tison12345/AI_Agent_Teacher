import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Baseline, Checkpoint, Progress } from "@/lib/schemas/checkpoint";

const api = vi.hoisted(() => ({
  fetchProgress: vi.fn(),
  recordBaseline: vi.fn(),
  completeWeek: vi.fn(),
  requestEvaluation: vi.fn(),
}));
vi.mock("@/lib/api/client", () => api);

import { ProgressSection } from "./ProgressSection";

const PROJECT = "123e4567-e89b-42d3-a456-426614174000";
const sha = (c: string) => c.repeat(40);
const baseline: Baseline = { projectId: PROJECT, commitSha: sha("0"), branch: "main", recordedAt: "2026-10-26T09:00:00+00:00" };
const checkpoint = (week: number, over: Partial<Checkpoint> = {}): Checkpoint => ({
  id: `00000000-0000-4000-8000-${String(week).padStart(12, "0")}`,
  projectId: PROJECT,
  weekNumber: week,
  commitSha: sha(String(week)),
  baseCommitSha: sha(String(week - 1)),
  branch: "main",
  filesChanged: 4,
  additions: 40,
  deletions: 5,
  recordedAt: "2026-10-26T10:00:00+00:00",
  ...over,
});
const progress = (over: Partial<Progress> = {}): Progress => ({ baseline: null, checkpoints: [], evaluations: [], ...over });
const submitted = (week: number) => ({ weekNumber: week, status: "pending_review" as const });

beforeEach(() => {
  vi.clearAllMocks();
  api.requestEvaluation.mockResolvedValue({ ok: true, status: "pending_review" });
});

const row = (week: number) => screen.getByText(`Week ${week}`).closest("li") as HTMLElement;

describe("ProgressSection: starting point and recording", () => {
  it("shows loading, then the starting-point prompt with every week locked", async () => {
    api.fetchProgress.mockResolvedValue(progress());
    render(<ProgressSection projectId={PROJECT} />);
    expect(screen.getByText("Loading progress…")).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Record starting point" })).toBeInTheDocument();
    expect(within(row(1)).getByText("Record your starting point first")).toBeInTheDocument();
    expect(within(row(2)).getByText("Complete Week 1 first")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Complete Week/ })).not.toBeInTheDocument();
  });

  it("shows a load error with retry", async () => {
    api.fetchProgress.mockRejectedValueOnce(new Error("Storage is not configured.")).mockResolvedValueOnce(progress());
    const user = userEvent.setup();
    render(<ProgressSection projectId={PROJECT} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Storage is not configured.");
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("button", { name: "Record starting point" })).toBeInTheDocument();
  });

  it("records the starting point, then unlocks Week 1 only", async () => {
    api.fetchProgress.mockResolvedValue(progress());
    api.recordBaseline.mockResolvedValue({ ok: true, value: baseline });
    const user = userEvent.setup();
    render(<ProgressSection projectId={PROJECT} />);
    await user.click(await screen.findByRole("button", { name: "Record starting point" }));
    const startingPoint = (await screen.findByText(/Starting point:/)).closest("p");
    expect(startingPoint).toHaveTextContent("0000000");
    expect(startingPoint).toHaveTextContent("main");
    expect(screen.getByRole("button", { name: "Complete Week 1" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Complete Week 2" })).not.toBeInTheDocument();
  });

  it("shows the reason when the starting point cannot be recorded", async () => {
    api.fetchProgress.mockResolvedValue(progress());
    api.recordBaseline.mockResolvedValue({ ok: false, message: "The repository has no commits yet." });
    const user = userEvent.setup();
    render(<ProgressSection projectId={PROJECT} />);
    await user.click(await screen.findByRole("button", { name: "Record starting point" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The repository has no commits yet.");
  });

  it("asks for confirmation before recording, and Cancel records nothing", async () => {
    api.fetchProgress.mockResolvedValue(progress({ baseline }));
    const user = userEvent.setup();
    render(<ProgressSection projectId={PROJECT} />);
    await user.click(await screen.findByRole("button", { name: "Complete Week 1" }));
    const confirm = screen.getByRole("group", { name: "Confirm Week 1" });
    expect(confirm).toHaveTextContent(/cannot be undone/);
    expect(confirm).toHaveTextContent(/Push all your work first/);
    await user.click(within(confirm).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("group", { name: "Confirm Week 1" })).not.toBeInTheDocument();
    expect(api.completeWeek).not.toHaveBeenCalled();
    expect(api.requestEvaluation).not.toHaveBeenCalled();
  });

  it("only one week is actionable at a time and recorded weeks cannot be redone", async () => {
    api.fetchProgress.mockResolvedValue(
      progress({ baseline, checkpoints: [checkpoint(1), checkpoint(2)], evaluations: [submitted(1), submitted(2)] }),
    );
    render(<ProgressSection projectId={PROJECT} />);
    expect(await screen.findByRole("button", { name: "Complete Week 3" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /Complete Week/ })).toHaveLength(1);
    expect(screen.getAllByText("Recorded · submitted for teacher review")).toHaveLength(2);
    expect(within(row(4)).getByText("Complete Week 3 first")).toBeInTheDocument();
  });

  it("shows why a week was refused and leaves it open for another try", async () => {
    api.fetchProgress.mockResolvedValue(progress({ baseline }));
    api.completeWeek.mockResolvedValue({
      ok: false,
      message: "No new commits since your starting point. Push your work to GitHub, then try again.",
    });
    const user = userEvent.setup();
    render(<ProgressSection projectId={PROJECT} />);
    await user.click(await screen.findByRole("button", { name: "Complete Week 1" }));
    await user.click(screen.getByRole("button", { name: "Yes, record Week 1" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("No new commits");
    expect(screen.getByRole("button", { name: "Complete Week 1" })).toBeEnabled();
    expect(api.requestEvaluation).not.toHaveBeenCalled(); // nothing recorded, nothing to evaluate
  });

  it("handles a network failure without recording anything", async () => {
    api.fetchProgress.mockResolvedValue(progress({ baseline }));
    api.completeWeek.mockRejectedValue(new Error("network"));
    const user = userEvent.setup();
    render(<ProgressSection projectId={PROJECT} />);
    await user.click(await screen.findByRole("button", { name: "Complete Week 1" }));
    await user.click(screen.getByRole("button", { name: "Yes, record Week 1" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/Could not reach the server/);
    expect(api.requestEvaluation).not.toHaveBeenCalled();
  });
});

describe("ProgressSection: evaluation after recording", () => {
  async function recordWeek1(user: ReturnType<typeof userEvent.setup>) {
    await user.click(await screen.findByRole("button", { name: "Complete Week 1" }));
    await user.click(screen.getByRole("button", { name: "Yes, record Week 1" }));
  }

  it("evaluates right after recording and ends as 'submitted for teacher review'", async () => {
    api.fetchProgress.mockResolvedValue(progress({ baseline }));
    api.completeWeek.mockResolvedValue({ ok: true, value: checkpoint(1) });
    const user = userEvent.setup();
    render(<ProgressSection projectId={PROJECT} />);
    await recordWeek1(user);
    expect(api.requestEvaluation).toHaveBeenCalledWith(PROJECT, 1);
    expect(await within(row(1)).findByText("Recorded · submitted for teacher review")).toBeInTheDocument();
    expect(row(1)).toHaveTextContent("4 files changed (+40 −5)");
    expect(screen.getByRole("button", { name: "Complete Week 2" })).toBeInTheDocument();
    expect(within(row(1)).queryByRole("button", { name: "Generate evaluation" })).not.toBeInTheDocument();
  });

  it("shows an 'evaluating' message while the AI works, and blocks other actions", async () => {
    api.fetchProgress.mockResolvedValue(progress({ baseline }));
    api.completeWeek.mockResolvedValue({ ok: true, value: checkpoint(1) });
    let resolve: (v: unknown) => void = () => {};
    api.requestEvaluation.mockReturnValue(new Promise((r) => (resolve = r)));
    const user = userEvent.setup();
    render(<ProgressSection projectId={PROJECT} />);
    await recordWeek1(user);
    expect(await within(row(1)).findByRole("status")).toHaveTextContent(/Evaluating your code changes/);
    expect(screen.getByRole("button", { name: "Complete Week 2" })).toBeDisabled();
    resolve({ ok: true, status: "pending_review" });
    expect(await within(row(1)).findByText("Recorded · submitted for teacher review")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Complete Week 2" })).toBeEnabled();
  });

  it("if the evaluation fails, the week stays recorded and can be evaluated again", async () => {
    api.fetchProgress.mockResolvedValue(progress({ baseline }));
    api.completeWeek.mockResolvedValue({ ok: true, value: checkpoint(1) });
    api.requestEvaluation
      .mockResolvedValueOnce({ ok: false, message: "Gemini is rate limiting requests. Please wait a minute and try again." })
      .mockResolvedValueOnce({ ok: true, status: "pending_review" });
    const user = userEvent.setup();
    render(<ProgressSection projectId={PROJECT} />);
    await recordWeek1(user);
    expect(await screen.findByRole("alert")).toHaveTextContent("rate limiting");
    expect(within(row(1)).getByText("Recorded · not yet evaluated")).toBeInTheDocument();
    await user.click(within(row(1)).getByRole("button", { name: "Generate evaluation" }));
    expect(await within(row(1)).findByText("Recorded · submitted for teacher review")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument(); // the failed attempt's message is gone
    expect(api.requestEvaluation).toHaveBeenCalledTimes(2);
    expect(api.completeWeek).toHaveBeenCalledTimes(1); // retrying never records again
  });

  it("a network error during evaluation is reported and leaves the checkpoint recorded", async () => {
    api.fetchProgress.mockResolvedValue(progress({ baseline }));
    api.completeWeek.mockResolvedValue({ ok: true, value: checkpoint(1) });
    api.requestEvaluation.mockRejectedValue(new Error("network"));
    const user = userEvent.setup();
    render(<ProgressSection projectId={PROJECT} />);
    await recordWeek1(user);
    expect(await screen.findByRole("alert")).toHaveTextContent(/Could not reach the server for the evaluation/);
    expect(within(row(1)).getByText("Recorded · not yet evaluated")).toBeInTheDocument();
  });

  it("an evaluation that already exists elsewhere just shows its status", async () => {
    api.fetchProgress.mockResolvedValue(progress({ baseline, checkpoints: [checkpoint(1)] }));
    api.requestEvaluation.mockResolvedValue({ ok: false, message: "Week 1 already has an evaluation.", status: "pending_review" });
    const user = userEvent.setup();
    render(<ProgressSection projectId={PROJECT} />);
    await user.click(await within(await screen.findByText("Week 1").then((el) => el.closest("li") as HTMLElement)).findByRole("button", { name: "Generate evaluation" }));
    expect(await within(row(1)).findByText("Recorded · submitted for teacher review")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("when the week was already recorded elsewhere, shows that checkpoint and does not evaluate automatically", async () => {
    api.fetchProgress.mockResolvedValue(progress({ baseline }));
    api.completeWeek.mockResolvedValue({
      ok: false,
      message: "Week 1 is already recorded and cannot be changed.",
      existing: checkpoint(1),
    });
    const user = userEvent.setup();
    render(<ProgressSection projectId={PROJECT} />);
    await recordWeek1(user);
    expect(await within(row(1)).findByText("Recorded · not yet evaluated")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("already recorded");
    expect(api.requestEvaluation).not.toHaveBeenCalled();
  });

  it("never shows a score to the student, and explains that marks come from the teacher", async () => {
    api.fetchProgress.mockResolvedValue(
      progress({ baseline, checkpoints: [checkpoint(1)], evaluations: [submitted(1)] }),
    );
    const { container } = render(<ProgressSection projectId={PROJECT} />);
    await screen.findByText("Recorded · submitted for teacher review");
    expect(container.textContent).not.toMatch(/\d+\s*\/\s*100|\bscore\b|suggested/i);
    expect(container.textContent).toMatch(/you will not see it/i);
    expect(container.textContent).toMatch(/only after your teacher reviews and approves/i);
  });

  it("shows a teacher-reviewed state once a decision exists (statuses other than pending)", async () => {
    api.fetchProgress.mockResolvedValue(
      progress({ baseline, checkpoints: [checkpoint(1)], evaluations: [{ weekNumber: 1, status: "approved" }] }),
    );
    render(<ProgressSection projectId={PROJECT} />);
    expect(await screen.findByText("Recorded · reviewed by your teacher")).toBeInTheDocument();
  });
});
