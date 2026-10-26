import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReviewDetail } from "@/lib/schemas/review";
import type { TeacherDecision } from "@/lib/schemas/teacher-decision";
import { reviewWorld } from "@/test/review-fixtures";

const api = vi.hoisted(() => ({ fetchReview: vi.fn(), sendDecision: vi.fn(), fetchReviewQuiz: vi.fn() }));
vi.mock("@/lib/api/client", () => api);

import { EvaluationReview } from "./EvaluationReview";

let detail: ReviewDetail;

const decisionOf = (over: Partial<TeacherDecision>): TeacherDecision => ({
  id: "00000000-0000-4000-a000-000000000001",
  evaluationId: detail.evaluation.id,
  decision: "approve",
  approvedScore: 94,
  approvedFeedback: "- Do X",
  comment: null,
  decidedAt: "2026-10-26T12:00:00+00:00",
  ...over,
});

beforeEach(async () => {
  vi.clearAllMocks();
  const world = reviewWorld();
  const { evaluation } = await world.seed(2);
  detail = (await world.review.store.getDetail(evaluation.id))!;
  api.fetchReview.mockResolvedValue(detail);
  api.fetchReviewQuiz.mockResolvedValue(null);
});

async function open() {
  const user = userEvent.setup();
  render(<EvaluationReview id={detail.evaluation.id} />);
  await screen.findByRole("heading", { name: /Library app · Week 2/ });
  return user;
}

describe("EvaluationReview: what the teacher sees", () => {
  it("labels the AI score as a recommendation and warns that a diff is not proof of authorship", async () => {
    await open();
    expect(screen.getByRole("heading", { name: "AI recommendation (not official)" })).toBeInTheDocument();
    expect(screen.getByLabelText("AI suggested score 94 out of 100")).toBeInTheDocument();
    expect(screen.getByText(/only a/)).toHaveTextContent(/recommendation/);
    expect(screen.getByText(/not proof of who wrote the code/)).toBeInTheDocument();
    expect(screen.getByText(/The code was never run/)).toBeInTheDocument();
  });

  it("shows each criterion with its evidence, the review scope and the diff", async () => {
    await open();
    expect(screen.getByText(/Add a book: 36\/40/)).toBeInTheDocument();
    expect(screen.getByText(/What the AI could see/)).toBeInTheDocument();
    expect(screen.getByText(/2 of 2 changed files reviewed/)).toBeInTheDocument();
    expect(screen.getByText(/Code executed: no/)).toBeInTheDocument();
    expect(screen.getByText(/function addBook/)).toBeInTheDocument();
  });

  it("shows student code as plain text, never as markup", async () => {
    detail = {
      ...detail,
      snapshot: {
        ...detail.snapshot,
        files: [{ ...detail.snapshot.files[0], patch: '+<img src=x onerror="alert(1)"><script>boom()</script>' }],
      },
    };
    api.fetchReview.mockResolvedValue(detail);
    const { container } = render(<EvaluationReview id={detail.evaluation.id} />);
    await screen.findByRole("heading", { name: /Library app · Week 2/ });
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain('<img src=x onerror="alert(1)">');
  });

  it("explains files the AI could not read", async () => {
    detail = {
      ...detail,
      evaluation: {
        ...detail.evaluation,
        reviewScope: {
          ...detail.evaluation.reviewScope,
          notReviewed: [{ path: "report.pdf", reason: "binary" }],
        },
      },
    };
    api.fetchReview.mockResolvedValue(detail);
    render(<EvaluationReview id={detail.evaluation.id} />);
    expect(await screen.findByText(/binary file/)).toBeInTheDocument();
  });

  it("handles a missing evaluation and a load failure", async () => {
    api.fetchReview.mockResolvedValueOnce(null);
    const { unmount } = render(<EvaluationReview id="x" />);
    expect(await screen.findByText("This evaluation does not exist.")).toBeInTheDocument();
    unmount();
    api.fetchReview.mockRejectedValueOnce(new Error("Storage is not configured on the server."));
    const user = userEvent.setup();
    render(<EvaluationReview id="x" />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Storage is not configured");
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("heading", { name: /Library app · Week 2/ })).toBeInTheDocument();
  });
});

describe("EvaluationReview: deciding", () => {
  it("approve: asks for confirmation, sends no score or feedback, then shows the official result", async () => {
    const user = await open();
    expect(screen.getByText("The student will see")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Review decision" }));
    expect(api.sendDecision).not.toHaveBeenCalled(); // not yet: needs confirmation
    expect(screen.getByRole("group", { name: "Confirm decision" })).toHaveTextContent(/final and cannot be changed/);
    api.sendDecision.mockResolvedValue({ ok: true, decision: decisionOf({}) });
    await user.click(screen.getByRole("button", { name: "Yes, record decision" }));
    expect(api.sendDecision).toHaveBeenCalledWith(detail.evaluation.id, { decision: "approve", comment: "" });
    expect(await screen.findByRole("heading", { name: "Official decision: Approved" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Review decision" })).not.toBeInTheDocument();
  });

  it("cancel at the confirmation sends nothing", async () => {
    const user = await open();
    await user.click(screen.getByRole("button", { name: "Review decision" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(api.sendDecision).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Review decision" })).toBeInTheDocument();
  });

  it("edit: needs a comment and a real change, then sends the numbers", async () => {
    const user = await open();
    await user.click(screen.getByRole("radio", { name: /Edit/ }));
    await user.click(screen.getByRole("button", { name: "Review decision" }));
    expect(await screen.findByText("A comment is required.")).toBeInTheDocument();
    expect(api.sendDecision).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText(/Private comment/), "AI missed a bug");
    await user.click(screen.getByRole("button", { name: "Review decision" }));
    expect(await screen.findByText("Change the score or the feedback, or choose Approve.")).toBeInTheDocument();
    expect(api.sendDecision).not.toHaveBeenCalled(); // same score and feedback as the AI: that is an approval

    const score = screen.getByLabelText("Official score (0–100)");
    await user.clear(score);
    await user.type(score, "70.5");
    await user.click(screen.getByRole("button", { name: "Review decision" }));
    api.sendDecision.mockResolvedValue({
      ok: true,
      decision: decisionOf({ decision: "edit", approvedScore: 70.5, comment: "AI missed a bug" }),
    });
    await user.click(screen.getByRole("button", { name: "Yes, record decision" }));
    expect(api.sendDecision).toHaveBeenCalledWith(
      detail.evaluation.id,
      expect.objectContaining({ decision: "edit", approvedScore: 70.5, comment: "AI missed a bug" }),
    );
    expect(await screen.findByRole("heading", { name: "Official decision: Edited" })).toBeInTheDocument();
    expect(screen.getByText(/the AI suggested 94/)).toBeInTheDocument();
    expect(screen.getByText("AI missed a bug")).toBeInTheDocument();
  });

  it.each(["101", "-1", ""])("edit rejects the score %j before sending", async (value) => {
    const user = await open();
    await user.click(screen.getByRole("radio", { name: /Edit/ }));
    const score = screen.getByLabelText("Official score (0–100)");
    await user.clear(score);
    if (value) await user.type(score, value);
    await user.type(screen.getByLabelText(/Private comment/), "c");
    await user.click(screen.getByRole("button", { name: "Review decision" }));
    expect(screen.queryByRole("group", { name: "Confirm decision" })).not.toBeInTheDocument();
    expect(api.sendDecision).not.toHaveBeenCalled();
  });

  it("reject: needs a reason and says the student gets no score", async () => {
    const user = await open();
    await user.click(screen.getByRole("radio", { name: /Reject/ }));
    await user.click(screen.getByRole("button", { name: "Review decision" }));
    expect(await screen.findByText("A comment is required.")).toBeInTheDocument();
    await user.type(screen.getByLabelText(/Private comment/), "Unreliable");
    await user.click(screen.getByRole("button", { name: "Review decision" }));
    expect(screen.getByRole("group", { name: "Confirm decision" })).toHaveTextContent(/no score for this week/);
    api.sendDecision.mockResolvedValue({
      ok: true,
      decision: decisionOf({ decision: "reject", approvedScore: null, approvedFeedback: null, comment: "Unreliable" }),
    });
    await user.click(screen.getByRole("button", { name: "Yes, record decision" }));
    expect(api.sendDecision).toHaveBeenCalledWith(detail.evaluation.id, { decision: "reject", comment: "Unreliable" });
    expect(await screen.findByText("No official score was given for this week.")).toBeInTheDocument();
  });

  it("shows the server's message when the decision was already made elsewhere", async () => {
    const user = await open();
    await user.click(screen.getByRole("button", { name: "Review decision" }));
    api.sendDecision.mockResolvedValue({ ok: false, message: "This evaluation has already been decided. A decision is final and cannot be changed." });
    await user.click(screen.getByRole("button", { name: "Yes, record decision" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/already been decided/);
    expect(screen.getByRole("button", { name: "Review decision" })).toBeInTheDocument();
  });

  it("reports a network failure and keeps the form", async () => {
    const user = await open();
    await user.click(screen.getByRole("button", { name: "Review decision" }));
    api.sendDecision.mockRejectedValue(new Error("network"));
    await user.click(screen.getByRole("button", { name: "Yes, record decision" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/Could not reach the server/);
    expect(screen.getByRole("button", { name: "Review decision" })).toBeInTheDocument();
  });

  it("an already-decided evaluation shows the official decision and no form", async () => {
    detail = {
      ...detail,
      evaluation: { ...detail.evaluation, status: "edited" },
      decision: decisionOf({ decision: "edit", approvedScore: 60, approvedFeedback: "Fix it", comment: "private" }),
    };
    api.fetchReview.mockResolvedValue(detail);
    render(<EvaluationReview id={detail.evaluation.id} />);
    const section = (await screen.findByRole("heading", { name: "Official decision: Edited" })).closest("section")!;
    expect(within(section).getByText(/60\/100/)).toBeInTheDocument();
    expect(within(section).getByText("Fix it")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Your decision" })).not.toBeInTheDocument();
  });
});
