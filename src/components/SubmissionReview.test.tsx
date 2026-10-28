import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { FacultySubmission } from "@/lib/schemas/submission";

const api = vi.hoisted(() => ({
  fetchFacultySubmission: vi.fn(),
  fetchFacultyAssignment: vi.fn(),
  runAiMarking: vi.fn(),
  decideSubmission: vi.fn(),
}));
vi.mock("@/lib/api/client", () => api);

import { FacultySubmissionDetail } from "./FacultySubmissionDetail";

const A = "123e4567-e89b-42d3-a456-426614174000";
const S = "223e4567-e89b-42d3-a456-426614174000";

const assignment = {
  id: A,
  title: "Loops",
  instructions: "Answer all.",
  questions: [
    { number: 1, text: "What is a loop?", maxMarks: 5, rubric: "Repetition." },
    { number: 2, text: "What is an array?", maxMarks: 2.5, rubric: "Ordered." },
  ],
  maxMarks: 7.5,
  createdAt: "2026-10-27T10:00:00+00:00",
  submissionCount: 1,
  hasReferenceAnswers: false,
  referenceAnswers: null,
};
const submission = (over: Partial<FacultySubmission> = {}): FacultySubmission => ({
  id: S,
  assignmentId: A,
  studentName: "Asha Fictional",
  fileName: "answers.docx",
  fileType: "docx",
  fileSize: 2048,
  status: "awaiting_review",
  error: null,
  createdAt: "2026-10-28T10:00:00+00:00",
  aiTotal: 6,
  hasText: true,
  extractedText: "A loop repeats code.",
  extraction: { pages: [{ number: 1, chars: 600 }], warnings: [] },
  downloadUrl: null,
  aiResult: {
    questions: [
      { number: 1, marks: 4, maxMarks: 5, explanation: "Defines repetition.", quotes: ["A loop repeats code"] },
      { number: 2, marks: 2, maxMarks: 2.5, explanation: "Mentions order.", quotes: ["ordered collection of values"] },
    ],
    feedback: "Good start.",
    notes: [],
  },
  aiModel: "gemini-test",
  decision: null,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  api.fetchFacultyAssignment.mockResolvedValue(assignment);
});

async function open(s: FacultySubmission) {
  api.fetchFacultySubmission.mockResolvedValue(s);
  const user = userEvent.setup();
  render(<FacultySubmissionDetail id={S} />);
  await screen.findByRole("heading", { level: 1, name: "Asha Fictional" });
  return user;
}

describe("AI recommendation", () => {
  it("shows the AI's marks as a recommendation, labelled not official, with explanation and quotes", async () => {
    const user = await open(submission());
    expect(screen.getByText("Not official")).toBeInTheDocument();
    expect(screen.getByLabelText("The AI recommends 6 out of 7.5")).toBeInTheDocument();
    expect(screen.getByText("Defines repetition.")).not.toBeVisible();
    await user.click(screen.getByRole("button", { name: /1\. What is a loop\?/ }));
    expect(screen.getByText("Defines repetition.")).toBeVisible();
    expect(screen.getByText("A loop repeats code")).toBeVisible();
    expect(screen.getByText("Good start.")).toBeInTheDocument();
    expect(screen.getByText(/gemini-test/)).toBeInTheDocument();
  });

  it("shows no official result while waiting for review", async () => {
    await open(submission());
    expect(screen.queryByText("Official faculty decision")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Your decision" })).toBeInTheDocument();
  });
});

describe("running the marking", () => {
  it("offers Run AI marking when the text was read but nothing has marked it, and shows the result", async () => {
    const marked = submission();
    api.runAiMarking.mockResolvedValue({ ok: true, submission: marked });
    const user = await open(submission({ status: "processing", aiResult: null, aiModel: null, aiTotal: null }));
    await user.click(screen.getByRole("button", { name: "Run AI marking" }));
    expect(api.runAiMarking).toHaveBeenCalledWith(S);
    expect(await screen.findByText("Not official")).toBeInTheDocument();
  });

  it("shows the failure message when the marking could not run", async () => {
    api.runAiMarking.mockResolvedValue({ ok: false, message: "Gemini is not configured on the server." });
    const user = await open(submission({ status: "processing", aiResult: null, aiModel: null, aiTotal: null }));
    await user.click(screen.getByRole("button", { name: "Run AI marking" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Gemini is not configured");
  });

  it("offers no marking button for a scanned file or a submission that is already marked", async () => {
    await open(submission({ status: "needs_ocr", error: "Scanned.", aiResult: null, aiModel: null, aiTotal: null }));
    expect(screen.queryByRole("button", { name: "Run AI marking" })).not.toBeInTheDocument();
  });
});

describe("the decision", () => {
  it("approve sends only the choice, then shows the official result", async () => {
    api.decideSubmission.mockResolvedValue({
      ok: true,
      submission: submission({
        status: "approved",
        decision: {
          decision: "approve",
          scores: [{ number: 1, marks: 4 }, { number: 2, marks: 2 }],
          finalTotal: 6,
          feedback: "Good start.",
          comment: null,
          decidedAt: "2026-10-28T11:00:00+00:00",
        },
      }),
    });
    const user = await open(submission());
    await user.click(screen.getByRole("button", { name: /Approve the AI's 6 \/ 7\.5/ }));
    expect(api.decideSubmission).toHaveBeenCalledWith(S, { decision: "approve" });
    expect(await screen.findByText("Official faculty decision")).toBeInTheDocument();
    expect(screen.getByLabelText("Official score 6 out of 7.5")).toBeInTheDocument();
    expect(screen.getAllByText("Approved")).toHaveLength(2); // the page header and the decision card
    expect(screen.queryByRole("heading", { name: "Your decision" })).not.toBeInTheDocument(); // final: no second decision
  });

  it("reject sends only the choice and shows no score", async () => {
    api.decideSubmission.mockResolvedValue({
      ok: true,
      submission: submission({
        status: "rejected",
        decision: { decision: "reject", scores: null, finalTotal: null, feedback: null, comment: null, decidedAt: "2026-10-28T11:00:00+00:00" },
      }),
    });
    const user = await open(submission());
    await user.click(screen.getByRole("button", { name: "Reject (no marks)" }));
    expect(api.decideSubmission).toHaveBeenCalledWith(S, { decision: "reject" });
    expect(await screen.findByText("No official score was given for this week.")).toBeInTheDocument();
  });

  it("edit needs valid marks, feedback and a comment, and sends the marks as typed", async () => {
    api.decideSubmission.mockResolvedValue({
      ok: true,
      submission: submission({
        status: "edited",
        decision: {
          decision: "edit",
          scores: [{ number: 1, marks: 5 }, { number: 2, marks: 2 }],
          finalTotal: 7,
          feedback: "Excellent.",
          comment: "The answer was complete.",
          decidedAt: "2026-10-28T11:00:00+00:00",
        },
      }),
    });
    const user = await open(submission());
    await user.click(screen.getByRole("button", { name: "Edit marks and feedback" }));

    await user.clear(screen.getByLabelText("Question 1 marks (0 to 5)"));
    await user.type(screen.getByLabelText("Question 1 marks (0 to 5)"), "9");
    await user.clear(screen.getByLabelText(/Feedback the student will see/));
    await user.click(screen.getByRole("button", { name: "Save the edited decision" }));
    expect(api.decideSubmission).not.toHaveBeenCalled();
    expect(screen.getByText("Enter 0 to 5.")).toBeInTheDocument();
    expect(screen.getByText("Write the feedback the student will see.")).toBeInTheDocument();
    expect(screen.getByText("Explain why you changed the AI's recommendation.")).toBeInTheDocument();

    await user.clear(screen.getByLabelText("Question 1 marks (0 to 5)"));
    await user.type(screen.getByLabelText("Question 1 marks (0 to 5)"), "5");
    await user.type(screen.getByLabelText(/Feedback the student will see/), "Excellent.");
    await user.type(screen.getByLabelText(/Private comment/), "The answer was complete.");
    await user.click(screen.getByRole("button", { name: "Save the edited decision" }));
    expect(api.decideSubmission).toHaveBeenCalledWith(S, {
      decision: "edit",
      scores: [{ number: 1, marks: 5 }, { number: 2, marks: 2 }],
      feedback: "Excellent.",
      comment: "The answer was complete.",
    });
    expect(await screen.findByText("Edited by faculty")).toBeInTheDocument();
    expect(screen.getByText("The AI had recommended 6 / 7.5.")).toBeInTheDocument();
    expect(screen.getByText("The answer was complete.")).toBeInTheDocument(); // the private comment, faculty only
  });

  it("shows the server's reason when a decision is refused, and stays open to try again", async () => {
    api.decideSubmission.mockResolvedValue({ ok: false, message: "This submission has already been decided. A decision is final." });
    const user = await open(submission());
    await user.click(screen.getByRole("button", { name: "Reject (no marks)" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("already been decided");
    expect(screen.getByRole("button", { name: "Reject (no marks)" })).toBeEnabled();
  });

  it("says that a decision is final before anything is sent", async () => {
    await open(submission());
    expect(screen.getByText(/A decision is final and cannot be changed/)).toBeInTheDocument();
  });

  it("an already decided submission shows its official result and no decision form", async () => {
    await open(
      submission({
        status: "approved",
        decision: {
          decision: "approve",
          scores: [{ number: 1, marks: 4 }, { number: 2, marks: 2 }],
          finalTotal: 6,
          feedback: "Good start.",
          comment: null,
          decidedAt: "2026-10-28T11:00:00+00:00",
        },
      }),
    );
    expect(screen.getByText("Official faculty decision")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Your decision" })).not.toBeInTheDocument();
  });
});
