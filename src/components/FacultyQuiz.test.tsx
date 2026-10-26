import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { QuizView } from "@/lib/schemas/quiz";

const api = vi.hoisted(() => ({ fetchReviewQuiz: vi.fn() }));
vi.mock("@/lib/api/client", () => api);

import { FacultyQuiz } from "./FacultyQuiz";

const quizId = "123e4567-e89b-42d3-a456-426614174000";
const questions = Array.from({ length: 5 }, (_, i) => ({
  question: `What does part ${i + 1} do?`,
  options: ["One", "Two", "Three", "Four"],
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("FacultyQuiz", () => {
  it("says no quiz exists when the student has not started one", async () => {
    api.fetchReviewQuiz.mockResolvedValue(null);
    render(<FacultyQuiz evaluationId="e1" />);
    expect(await screen.findByText(/No quiz has been created for this week/)).toBeInTheDocument();
    expect(api.fetchReviewQuiz).toHaveBeenCalledWith("e1");
  });

  it("says the student has not submitted when the quiz is still open, without showing questions", async () => {
    const open: QuizView = { state: "open", quizId, weekNumber: 1, questions };
    api.fetchReviewQuiz.mockResolvedValue(open);
    render(<FacultyQuiz evaluationId="e1" />);
    expect(await screen.findByText(/has not submitted an attempt yet/)).toBeInTheDocument();
    expect(screen.queryByText(/What does part 1 do/)).not.toBeInTheDocument();
  });

  it("shows the score and the review, and that it is separate from the AI's score", async () => {
    const taken: QuizView = {
      state: "taken",
      quizId,
      weekNumber: 1,
      correctCount: 3,
      total: 5,
      submittedAt: "2026-10-27T10:05:00+00:00",
      questions: questions.map((q, i) => ({ ...q, correctIndex: 1, chosenIndex: i < 3 ? 1 : 2, explanation: `Why ${i + 1}.` })),
    };
    api.fetchReviewQuiz.mockResolvedValue(taken);
    render(<FacultyQuiz evaluationId="e1" />);
    expect(await screen.findByText(/Quiz result: 3\/5 correct/)).toBeInTheDocument();
    expect(screen.getByText(/does not change the AI's score/)).toBeInTheDocument();
    expect(screen.getByText("Why 5.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Student quiz \(separate evidence\)/ })).toBeInTheDocument();
  });

  it("shows an error when the quiz cannot be loaded", async () => {
    api.fetchReviewQuiz.mockRejectedValue(new Error("Storage is not configured on the server."));
    render(<FacultyQuiz evaluationId="e1" />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Storage is not configured on the server.");
  });
});
