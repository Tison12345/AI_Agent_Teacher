import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Baseline, Checkpoint, Progress } from "@/lib/schemas/checkpoint";

const api = vi.hoisted(() => ({
  fetchProgress: vi.fn(),
  recordBaseline: vi.fn(),
  completeWeek: vi.fn(),
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
const progress = (over: Partial<Progress> = {}): Progress => ({ baseline: null, checkpoints: [], ...over });

beforeEach(() => vi.clearAllMocks());

const row = (week: number) => screen.getByText(`Week ${week}`).closest("li") as HTMLElement;

describe("ProgressSection", () => {
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
    expect(screen.queryByRole("button", { name: "Record starting point" })).not.toBeInTheDocument();
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
    expect(api.completeWeek).not.toHaveBeenCalled();
    await user.click(within(confirm).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("group", { name: "Confirm Week 1" })).not.toBeInTheDocument();
    expect(api.completeWeek).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Complete Week 1" })).toBeInTheDocument();
  });

  it("records the week after confirmation, labelled as recorded but not evaluated", async () => {
    api.fetchProgress.mockResolvedValue(progress({ baseline }));
    api.completeWeek.mockResolvedValue({ ok: true, value: checkpoint(1) });
    const user = userEvent.setup();
    render(<ProgressSection projectId={PROJECT} />);
    await user.click(await screen.findByRole("button", { name: "Complete Week 1" }));
    await user.click(screen.getByRole("button", { name: "Yes, record Week 1" }));
    expect(api.completeWeek).toHaveBeenCalledWith(PROJECT, 1);
    expect(await within(row(1)).findByText("Recorded · not yet evaluated")).toBeInTheDocument();
    expect(row(1)).toHaveTextContent("4 files changed (+40 −5)");
    expect(row(1)).toHaveTextContent("1111111"); // commit
    expect(row(1)).toHaveTextContent("0000000"); // base
    // Week 2 unlocks, Week 1 can no longer be completed.
    expect(screen.getByRole("button", { name: "Complete Week 2" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Complete Week 1" })).not.toBeInTheDocument();
    expect(screen.getByText(/not a mark/i)).toBeInTheDocument();
  });

  it("only one week is actionable at a time and recorded weeks cannot be redone", async () => {
    api.fetchProgress.mockResolvedValue(progress({ baseline, checkpoints: [checkpoint(1), checkpoint(2)] }));
    render(<ProgressSection projectId={PROJECT} />);
    expect(await screen.findByRole("button", { name: "Complete Week 3" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /Complete Week/ })).toHaveLength(1);
    expect(screen.getAllByText("Recorded · not yet evaluated")).toHaveLength(2);
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
    expect(within(row(1)).queryByText("Recorded · not yet evaluated")).not.toBeInTheDocument();
  });

  it("when the week was already recorded elsewhere, shows that checkpoint instead of failing", async () => {
    api.fetchProgress.mockResolvedValue(progress({ baseline }));
    api.completeWeek.mockResolvedValue({
      ok: false,
      message: "Week 1 is already recorded and cannot be changed.",
      existing: checkpoint(1),
    });
    const user = userEvent.setup();
    render(<ProgressSection projectId={PROJECT} />);
    await user.click(await screen.findByRole("button", { name: "Complete Week 1" }));
    await user.click(screen.getByRole("button", { name: "Yes, record Week 1" }));
    expect(await within(row(1)).findByText("Recorded · not yet evaluated")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("already recorded");
  });

  it("sends only one request even if the confirm button is clicked repeatedly", async () => {
    api.fetchProgress.mockResolvedValue(progress({ baseline }));
    let resolve: (v: unknown) => void = () => {};
    api.completeWeek.mockReturnValue(new Promise((r) => (resolve = r)));
    const user = userEvent.setup();
    render(<ProgressSection projectId={PROJECT} />);
    await user.click(await screen.findByRole("button", { name: "Complete Week 1" }));
    const yes = screen.getByRole("button", { name: "Yes, record Week 1" });
    await user.click(yes);
    await user.click(yes).catch(() => {}); // the button is gone once recording starts
    expect(api.completeWeek).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole("button", { name: "Recording…" })).toBeDisabled();
    resolve({ ok: true, value: checkpoint(1) });
    expect(await within(row(1)).findByText("Recorded · not yet evaluated")).toBeInTheDocument();
    expect(api.completeWeek).toHaveBeenCalledTimes(1);
  });

  it("handles a network failure without recording anything", async () => {
    api.fetchProgress.mockResolvedValue(progress({ baseline }));
    api.completeWeek.mockRejectedValue(new Error("network"));
    const user = userEvent.setup();
    render(<ProgressSection projectId={PROJECT} />);
    await user.click(await screen.findByRole("button", { name: "Complete Week 1" }));
    await user.click(screen.getByRole("button", { name: "Yes, record Week 1" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/Could not reach the server/);
    expect(within(row(1)).queryByText("Recorded · not yet evaluated")).not.toBeInTheDocument();
  });
});
