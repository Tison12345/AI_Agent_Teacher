import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Baseline, Checkpoint, Progress } from "@/lib/schemas/checkpoint";

const api = vi.hoisted(() => ({
  fetchProgress: vi.fn(),
  recordBaseline: vi.fn(),
  completeWeek: vi.fn(),
  requestEvaluation: vi.fn(),
  fetchResults: vi.fn(),
  fetchQuiz: vi.fn(),
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
  api.fetchResults.mockResolvedValue([]);
  api.fetchQuiz.mockResolvedValue(null);
});

const row = (week: number) => screen.getByText(`Week ${week}`).closest("li") as HTMLElement;

describe("ProgressSection: starting point and recording", () => {
  it("shows loading, then the starting-point prompt with every week locked", async () => {
    api.fetchProgress.mockResolvedValue(progress());
    render(<ProgressSection projectId={PROJECT} durationWeeks={12} />);
    expect(screen.getByText("Loading progress…")).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Record starting point" })).toBeInTheDocument();
    expect(within(row(1)).getByText("Record your starting point first")).toBeInTheDocument();
    expect(within(row(2)).getByText("Complete Week 1 first")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Complete Week/ })).not.toBeInTheDocument();
  });

  it("shows a load error with retry", async () => {
    api.fetchProgress.mockRejectedValueOnce(new Error("Storage is not configured.")).mockResolvedValueOnce(progress());
    const user = userEvent.setup();
    render(<ProgressSection projectId={PROJECT} durationWeeks={12} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Storage is not configured.");
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("button", { name: "Record starting point" })).toBeInTheDocument();
  });

  it("records the starting point, then unlocks Week 1 only", async () => {
    api.fetchProgress.mockResolvedValue(progress());
    api.recordBaseline.mockResolvedValue({ ok: true, value: baseline });
    const user = userEvent.setup();
    render(<ProgressSection projectId={PROJECT} durationWeeks={12} />);
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
    render(<ProgressSection projectId={PROJECT} durationWeeks={12} />);
    await user.click(await screen.findByRole("button", { name: "Record starting point" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The repository has no commits yet.");
  });

  it("asks for confirmation before recording, and Cancel records nothing", async () => {
    api.fetchProgress.mockResolvedValue(progress({ baseline }));
    const user = userEvent.setup();
    render(<ProgressSection projectId={PROJECT} durationWeeks={12} />);
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
    render(<ProgressSection projectId={PROJECT} durationWeeks={12} />);
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
    render(<ProgressSection projectId={PROJECT} durationWeeks={12} />);
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
    render(<ProgressSection projectId={PROJECT} durationWeeks={12} />);
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
    render(<ProgressSection projectId={PROJECT} durationWeeks={12} />);
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
    render(<ProgressSection projectId={PROJECT} durationWeeks={12} />);
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
    render(<ProgressSection projectId={PROJECT} durationWeeks={12} />);
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
    render(<ProgressSection projectId={PROJECT} durationWeeks={12} />);
    await recordWeek1(user);
    expect(await screen.findByRole("alert")).toHaveTextContent(/Could not reach the server for the evaluation/);
    expect(within(row(1)).getByText("Recorded · not yet evaluated")).toBeInTheDocument();
  });

  it("an evaluation that already exists elsewhere just shows its status", async () => {
    api.fetchProgress.mockResolvedValue(progress({ baseline, checkpoints: [checkpoint(1)] }));
    api.requestEvaluation.mockResolvedValue({ ok: false, message: "Week 1 already has an evaluation.", status: "pending_review" });
    const user = userEvent.setup();
    render(<ProgressSection projectId={PROJECT} durationWeeks={12} />);
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
    render(<ProgressSection projectId={PROJECT} durationWeeks={12} />);
    await recordWeek1(user);
    expect(await within(row(1)).findByText("Recorded · not yet evaluated")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("already recorded");
    expect(api.requestEvaluation).not.toHaveBeenCalled();
  });

  it("never shows a score to the student, and explains that marks come from the teacher", async () => {
    api.fetchProgress.mockResolvedValue(
      progress({ baseline, checkpoints: [checkpoint(1)], evaluations: [submitted(1)] }),
    );
    const { container } = render(<ProgressSection projectId={PROJECT} durationWeeks={12} />);
    await screen.findByText("Recorded · submitted for teacher review");
    expect(container.textContent).not.toMatch(/\d+\s*\/\s*100|\bscore\b|suggested/i);
    expect(container.textContent).toMatch(/you will not see it/i);
    expect(container.textContent).toMatch(/only after your teacher reviews and approves/i);
  });

  it("shows a teacher-reviewed state once a decision exists (statuses other than pending)", async () => {
    api.fetchProgress.mockResolvedValue(
      progress({ baseline, checkpoints: [checkpoint(1)], evaluations: [{ weekNumber: 1, status: "approved" }] }),
    );
    render(<ProgressSection projectId={PROJECT} durationWeeks={12} />);
    expect(await screen.findByText("Recorded · reviewed by your teacher")).toBeInTheDocument();
  });
});

describe("ProgressSection: the teacher's official result", () => {
  const decided = (weekNumber: number, status: "approved" | "edited" | "rejected") => ({ weekNumber, status });
  const result = (over: object) => ({
    weekNumber: 1,
    outcome: "approved",
    officialScore: 82.5,
    feedback: "- Add validation\n- Reset the form",
    decidedAt: "2026-10-26T12:00:00+00:00",
    ...over,
  });

  it("shows the official score and the teacher's feedback once a teacher has decided", async () => {
    api.fetchProgress.mockResolvedValue(
      progress({ baseline, checkpoints: [checkpoint(1)], evaluations: [decided(1, "approved")] }),
    );
    api.fetchResults.mockResolvedValue([result({})]);
    render(<ProgressSection projectId={PROJECT} durationWeeks={12} />);
    await screen.findByText("Recorded · reviewed by your teacher");
    const decision = await within(row(1)).findByRole("region", { name: "Official faculty decision" });
    expect(within(decision).getByLabelText("Official score 82.5 out of 100")).toBeInTheDocument();
    expect(decision).toHaveTextContent("Approved");
    expect(within(decision).getByText("Faculty feedback")).toBeInTheDocument();
    expect(row(1)).toHaveTextContent("Add validation");
    expect(api.fetchResults).toHaveBeenCalledWith(PROJECT);
  });

  it("shows no score for a rejected week, only that the teacher reviewed it", async () => {
    api.fetchProgress.mockResolvedValue(
      progress({ baseline, checkpoints: [checkpoint(1)], evaluations: [decided(1, "rejected")] }),
    );
    api.fetchResults.mockResolvedValue([result({ outcome: "rejected", officialScore: null, feedback: null })]);
    render(<ProgressSection projectId={PROJECT} durationWeeks={12} />);
    await screen.findByText("Recorded · reviewed by your teacher");
    const decision = await within(row(1)).findByRole("region", { name: "Official faculty decision" });
    expect(decision).toHaveTextContent("Rejected");
    expect(decision).toHaveTextContent("No official score was given");
    expect(row(1).textContent).not.toMatch(/\d+\s*\/\s*100/);
  });

  it("does not ask for results while every evaluation is still waiting for review", async () => {
    api.fetchProgress.mockResolvedValue(
      progress({ baseline, checkpoints: [checkpoint(1)], evaluations: [submitted(1)] }),
    );
    render(<ProgressSection projectId={PROJECT} durationWeeks={12} />);
    await screen.findByText("Recorded · submitted for teacher review");
    expect(api.fetchResults).not.toHaveBeenCalled();
    expect(within(row(1)).queryByRole("region", { name: "Official faculty decision" })).not.toBeInTheDocument();
  });

  it("says so when the result cannot be loaded, instead of showing nothing", async () => {
    api.fetchProgress.mockResolvedValue(
      progress({ baseline, checkpoints: [checkpoint(1)], evaluations: [decided(1, "edited")] }),
    );
    api.fetchResults.mockRejectedValue(new Error("network"));
    render(<ProgressSection projectId={PROJECT} durationWeeks={12} />);
    await screen.findByText("Recorded · reviewed by your teacher");
    expect(await within(row(1)).findByRole("alert")).toHaveTextContent(/result could not be loaded/);
  });
});

describe("ProgressSection: the summary cards", () => {
  const decided = (weekNumber: number, status: "approved" | "edited" | "rejected") => ({ weekNumber, status });
  const result = (weekNumber: number, officialScore: number | null, outcome = "approved") => ({
    weekNumber,
    outcome,
    officialScore,
    feedback: null,
    decidedAt: "2026-10-26T12:00:00+00:00",
  });
  const card = (name: string) => screen.getByRole("region", { name }) as HTMLElement;

  it("before any review: no average is invented, and the progress card counts the recorded weeks", async () => {
    api.fetchProgress.mockResolvedValue(
      progress({ baseline, checkpoints: [checkpoint(1), checkpoint(2)], evaluations: [submitted(1), submitted(2)] }),
    );
    render(<ProgressSection projectId={PROJECT} durationWeeks={4} />);
    const average = await screen.findByRole("region", { name: "Average official result" });
    expect(average).toHaveTextContent("No reviewed weeks yet");
    expect(average.textContent).not.toMatch(/\d+\s*\/\s*100/);
    const progressCard = card("Project progress");
    expect(progressCard).toHaveTextContent("2of 4");
    expect(progressCard).toHaveTextContent("0 approved");
    expect(progressCard).toHaveTextContent("2 waiting for review");
    expect(progressCard).toHaveTextContent("2 not recorded");
    expect(within(progressCard).getByRole("progressbar")).toHaveAttribute("aria-valuenow", "50");
  });

  it("averages only the teacher's real official scores, ignoring a rejected week", async () => {
    api.fetchProgress.mockResolvedValue(
      progress({
        baseline,
        checkpoints: [checkpoint(1), checkpoint(2), checkpoint(3)],
        evaluations: [decided(1, "approved"), decided(2, "edited"), decided(3, "rejected")],
      }),
    );
    api.fetchResults.mockResolvedValue([result(1, 80), result(2, 65), result(3, null, "rejected")]);
    render(<ProgressSection projectId={PROJECT} durationWeeks={4} />);
    const average = await screen.findByRole("region", { name: "Average official result" });
    await within(average).findByText("72.5");
    expect(average).toHaveTextContent("Average of 2 teacher-approved weeks out of 4. This is not a final grade.");
    expect(within(average).getByRole("progressbar")).toHaveAttribute("aria-valuenow", "73");
    // The chart shows each week's real result and a dash where there is none.
    const bars = within(average).getByRole("group", { name: "Official result by week" });
    expect(bars).toHaveTextContent("W1: 80 out of 100");
    expect(bars).toHaveTextContent("W2: 65 out of 100");
    expect(bars).toHaveTextContent("W3 has no official result");
    expect(bars).toHaveTextContent("W4 has no official result");
    expect(card("Project progress")).toHaveTextContent("2 approved");
  });
});

describe("ProgressSection: the project dashboard", () => {
  const stat = (label: string) => screen.getByText(label).closest("div")!.parentElement as HTMLElement;

  it("counts approved, pending and unrecorded weeks, which add up to the project's length", async () => {
    api.fetchProgress.mockResolvedValue(
      progress({
        baseline,
        checkpoints: [checkpoint(1), checkpoint(2), checkpoint(3)],
        evaluations: [
          { weekNumber: 1, status: "approved" },
          { weekNumber: 2, status: "edited" },
          { weekNumber: 3, status: "pending_review" },
        ],
      }),
    );
    api.fetchResults.mockResolvedValue([
      { weekNumber: 1, outcome: "approved", officialScore: 80, feedback: null, decidedAt: "2026-10-26T12:00:00+00:00" },
      { weekNumber: 2, outcome: "edited", officialScore: 60, feedback: null, decidedAt: "2026-10-26T12:00:00+00:00" },
    ]);
    render(<ProgressSection projectId={PROJECT} durationWeeks={5} />);
    await screen.findByText("Approved weeks");
    expect(stat("Approved weeks")).toHaveTextContent("2");
    expect(stat("Pending reviews")).toHaveTextContent("1");
    expect(stat("Unrecorded weeks")).toHaveTextContent("2");
    const bars = await screen.findByRole("group", { name: "Official result by week" });
    expect(bars).toHaveTextContent("W3 has no official result (Awaiting review)");
    expect(bars).toHaveTextContent("W4 has no official result (Not recorded)");
  });

  it("a project with one recorded week and a score of zero shows 0, not an empty chart", async () => {
    api.fetchProgress.mockResolvedValue(
      progress({ baseline, checkpoints: [checkpoint(1)], evaluations: [{ weekNumber: 1, status: "approved" }] }),
    );
    api.fetchResults.mockResolvedValue([
      { weekNumber: 1, outcome: "approved", officialScore: 0, feedback: null, decidedAt: "2026-10-26T12:00:00+00:00" },
    ]);
    render(<ProgressSection projectId={PROJECT} durationWeeks={1} />);
    const average = await screen.findByRole("region", { name: "Average official result" });
    expect(await within(average).findByLabelText("Average official result: 0 out of 100")).toBeInTheDocument();
    expect(within(average).getByRole("group")).toHaveTextContent("W1: 0 out of 100");
  });

  it("the week's official decision uses the indigo card, not the green quiz colours", async () => {
    api.fetchProgress.mockResolvedValue(
      progress({ baseline, checkpoints: [checkpoint(1)], evaluations: [{ weekNumber: 1, status: "approved" }] }),
    );
    api.fetchResults.mockResolvedValue([
      { weekNumber: 1, outcome: "approved", officialScore: 100, feedback: "Well done", decidedAt: "2026-10-26T12:00:00+00:00" },
    ]);
    render(<ProgressSection projectId={PROJECT} durationWeeks={2} />);
    await screen.findByText("Recorded · reviewed by your teacher");
    const decision = await within(row(1)).findByRole("region", { name: "Official faculty decision" });
    expect(decision).toHaveClass("card-official");
    expect(decision).not.toHaveClass("alert-success");
    expect(decision).toHaveTextContent("Well done");
  });
});

describe("ProgressSection: the project decides how many weeks are listed", () => {
  it.each([1, 4, 16])("lists exactly %i weeks for a project of that length", async (durationWeeks) => {
    api.fetchProgress.mockResolvedValue(progress({ baseline }));
    render(<ProgressSection projectId={PROJECT} durationWeeks={durationWeeks} />);
    await screen.findByRole("button", { name: "Complete Week 1" });
    expect(screen.getAllByRole("listitem")).toHaveLength(durationWeeks);
    expect(screen.getByText(`Week ${durationWeeks}`)).toBeInTheDocument();
    expect(screen.queryByText(`Week ${durationWeeks + 1}`)).not.toBeInTheDocument();
  });

  it("a short project has no locked weeks after its last one", async () => {
    api.fetchProgress.mockResolvedValue(
      progress({ baseline, checkpoints: [checkpoint(1), checkpoint(2)], evaluations: [submitted(1), submitted(2)] }),
    );
    render(<ProgressSection projectId={PROJECT} durationWeeks={3} />);
    expect(await screen.findByRole("button", { name: "Complete Week 3" })).toBeInTheDocument();
    expect(screen.queryByText("Week 4")).not.toBeInTheDocument();
  });
});
