import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { QuizView } from "@/lib/schemas/quiz";

const api = vi.hoisted(() => ({ fetchQuiz: vi.fn(), createQuiz: vi.fn(), submitQuiz: vi.fn() }));
vi.mock("@/lib/api/client", () => api);

import { QuizPanel } from "./QuizPanel";

const quizId = "123e4567-e89b-42d3-a456-426614174000";

const open: Extract<QuizView, { state: "open" }> = {
  state: "open",
  quizId,
  weekNumber: 2,
  questions: Array.from({ length: 5 }, (_, i) => ({
    question: `What does part ${i + 1} do?`,
    options: [`Option one ${i + 1}`, `Option two ${i + 1}`, `Option three ${i + 1}`, `Option four ${i + 1}`],
  })),
};

const taken = (correct: number): Extract<QuizView, { state: "taken" }> => ({
  state: "taken",
  quizId,
  weekNumber: 2,
  correctCount: correct,
  total: 5,
  submittedAt: "2026-10-27T10:05:00+00:00",
  questions: open.questions.map((q, i) => ({
    ...q,
    correctIndex: 1,
    chosenIndex: i < correct ? 1 : 0,
    explanation: `Explanation ${i + 1}.`,
  })),
});

beforeEach(() => {
  vi.clearAllMocks();
});

async function start(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Week 2 quiz" }));
}

describe("QuizPanel", () => {
  it("asks for nothing until the student clicks, and says there is one attempt", () => {
    render(<QuizPanel projectId="p1" week={2} />);
    expect(screen.getByRole("button", { name: "Week 2 quiz" })).toBeInTheDocument();
    expect(screen.getByText(/One attempt/)).toBeInTheDocument();
    expect(api.fetchQuiz).not.toHaveBeenCalled();
    expect(api.createQuiz).not.toHaveBeenCalled();
  });

  it("opens an existing quiz without creating a new one", async () => {
    api.fetchQuiz.mockResolvedValue(open);
    const user = userEvent.setup();
    render(<QuizPanel projectId="p1" week={2} />);
    await start(user);
    expect(await screen.findByRole("form", { name: "Week 2 quiz" })).toBeInTheDocument();
    expect(api.fetchQuiz).toHaveBeenCalledWith("p1", 2);
    expect(api.createQuiz).not.toHaveBeenCalled();
  });

  it("creates the quiz when there is none yet, showing that it can take a while", async () => {
    api.fetchQuiz.mockResolvedValue(null);
    let finish: (value: unknown) => void = () => {};
    api.createQuiz.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    const user = userEvent.setup();
    render(<QuizPanel projectId="p1" week={2} />);
    await start(user);
    expect(await screen.findByRole("status")).toHaveTextContent(/Writing your quiz.*up to a minute/);
    finish({ ok: true, quiz: open });
    expect(await screen.findByRole("form", { name: "Week 2 quiz" })).toBeInTheDocument();
    expect(api.createQuiz).toHaveBeenCalledWith("p1", 2);
  });

  it("if another request created the quiz first, it loads that one", async () => {
    api.fetchQuiz.mockResolvedValueOnce(null).mockResolvedValueOnce(open);
    api.createQuiz.mockResolvedValue({ ok: false, code: "quiz_exists", message: "Week 2 already has a quiz." });
    const user = userEvent.setup();
    render(<QuizPanel projectId="p1" week={2} />);
    await start(user);
    expect(await screen.findByRole("form", { name: "Week 2 quiz" })).toBeInTheDocument();
  });

  it("shows the server's reason when the quiz cannot be created, and allows trying again", async () => {
    api.fetchQuiz.mockResolvedValue(null);
    api.createQuiz.mockResolvedValueOnce({ ok: false, code: "gemini_rate_limited", message: "Gemini is rate limiting requests." });
    const user = userEvent.setup();
    render(<QuizPanel projectId="p1" week={2} />);
    await start(user);
    expect(await screen.findByRole("alert")).toHaveTextContent("Gemini is rate limiting requests.");
    api.createQuiz.mockResolvedValueOnce({ ok: true, quiz: open });
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("form", { name: "Week 2 quiz" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows a network failure as an error", async () => {
    api.fetchQuiz.mockRejectedValue(new Error("Request failed (500)."));
    const user = userEvent.setup();
    render(<QuizPanel projectId="p1" week={2} />);
    await start(user);
    expect(await screen.findByRole("alert")).toHaveTextContent("Request failed (500).");
  });

  it("a quiz that was already taken is shown as its review straight away", async () => {
    api.fetchQuiz.mockResolvedValue(taken(4));
    const user = userEvent.setup();
    render(<QuizPanel projectId="p1" week={2} />);
    await start(user);
    expect(await screen.findByText(/Quiz result: 4\/5 correct/)).toBeInTheDocument();
    expect(screen.queryByRole("form")).not.toBeInTheDocument();
  });
});

describe("taking the quiz", () => {
  async function openForm() {
    api.fetchQuiz.mockResolvedValue(open);
    const user = userEvent.setup();
    render(<QuizPanel projectId="p1" week={2} />);
    await start(user);
    await screen.findByRole("form", { name: "Week 2 quiz" });
    return user;
  }
  const submit = () => screen.getByRole("button", { name: /Submit my answers|Submitting/ });
  const answer = async (user: ReturnType<typeof userEvent.setup>, question: number, option: number) => {
    const group = screen.getByRole("group", { name: new RegExp(`^${question}\\. `) });
    await user.click(within(group).getAllByRole("radio")[option]);
  };

  it("shows five questions with four options each, and no answers or explanations", async () => {
    await openForm();
    expect(screen.getAllByRole("group")).toHaveLength(5);
    expect(screen.getAllByRole("radio")).toHaveLength(20);
    expect(screen.queryByText(/Explanation|Right answer|Correct/)).not.toBeInTheDocument();
    expect(screen.getByText("once").parentElement).toHaveTextContent(/You can submit once/);
  });

  it("cannot be submitted until every question is answered", async () => {
    const user = await openForm();
    expect(submit()).toBeDisabled();
    for (let q = 1; q <= 4; q++) await answer(user, q, 0);
    expect(submit()).toBeDisabled();
    expect(screen.getByText(/Choose one option for every question/)).toBeInTheDocument();
    await answer(user, 5, 2);
    expect(submit()).toBeEnabled();
  });

  it("sends the chosen option for each question and then shows the graded review", async () => {
    api.submitQuiz.mockResolvedValue({ ok: true, quiz: taken(3) });
    const user = await openForm();
    const choices = [0, 1, 2, 3, 1];
    for (const [i, option] of choices.entries()) await answer(user, i + 1, option);
    await user.click(submit());
    expect(api.submitQuiz).toHaveBeenCalledWith("p1", 2, choices);
    expect(await screen.findByText(/Quiz result: 3\/5 correct/)).toBeInTheDocument();
    expect(screen.getByText("Explanation 1.")).toBeInTheDocument();
    expect(screen.queryByRole("form")).not.toBeInTheDocument();
    expect(screen.getAllByText(/^Not correct\./)).toHaveLength(2);
    expect(screen.getAllByText(/^Correct\./)).toHaveLength(3);
  });

  it("lets a student change an answer before submitting", async () => {
    api.submitQuiz.mockResolvedValue({ ok: true, quiz: taken(5) });
    const user = await openForm();
    for (let q = 1; q <= 5; q++) await answer(user, q, 0);
    await answer(user, 3, 3);
    await user.click(submit());
    expect(api.submitQuiz).toHaveBeenCalledWith("p1", 2, [0, 0, 3, 0, 0]);
  });

  it("keeps the answers and shows the reason when the server refuses", async () => {
    api.submitQuiz.mockResolvedValue({ ok: false, code: "internal_error", message: "Something went wrong. Please try again." });
    const user = await openForm();
    for (let q = 1; q <= 5; q++) await answer(user, q, 2);
    await user.click(submit());
    expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong");
    expect(screen.getAllByRole("radio", { checked: true })).toHaveLength(5);
    expect(submit()).toBeEnabled();
  });

  it("shows the saved result if the quiz was already taken elsewhere", async () => {
    api.submitQuiz.mockResolvedValue({ ok: false, code: "already_attempted", message: "The Week 2 quiz has already been taken." });
    const user = await openForm();
    api.fetchQuiz.mockResolvedValue(taken(2));
    for (let q = 1; q <= 5; q++) await answer(user, q, 0);
    await user.click(submit());
    expect(await screen.findByText(/Quiz result: 2\/5 correct/)).toBeInTheDocument();
  });

  it("does not send twice while a submission is in progress", async () => {
    let finish: (value: unknown) => void = () => {};
    api.submitQuiz.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    const user = await openForm();
    for (let q = 1; q <= 5; q++) await answer(user, q, 0);
    await user.click(submit());
    expect(submit()).toBeDisabled();
    await user.click(submit());
    expect(api.submitQuiz).toHaveBeenCalledTimes(1);
    finish({ ok: true, quiz: taken(5) });
    expect(await screen.findByText(/Quiz result: 5\/5/)).toBeInTheDocument();
  });

  it("explains a network failure without losing the answers", async () => {
    api.submitQuiz.mockRejectedValue(new Error("network"));
    const user = await openForm();
    for (let q = 1; q <= 5; q++) await answer(user, q, 1);
    await user.click(submit());
    expect(await screen.findByRole("alert")).toHaveTextContent(/Could not reach the server/);
    expect(screen.getAllByRole("radio", { checked: true })).toHaveLength(5);
  });
});

describe("the graded review", () => {
  it("shows the right answer only for the questions that were wrong", async () => {
    api.fetchQuiz.mockResolvedValue(taken(4));
    const user = userEvent.setup();
    render(<QuizPanel projectId="p1" week={2} />);
    await start(user);
    await screen.findByText(/Quiz result/);
    expect(screen.getAllByText(/Right answer:/)).toHaveLength(1);
    expect(screen.getByText(/Right answer:/).parentElement).toHaveTextContent("B. Option two 5");
  });
});
