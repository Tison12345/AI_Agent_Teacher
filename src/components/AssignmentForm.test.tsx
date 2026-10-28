import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AssignmentForm } from "./AssignmentForm";

async function fillFirst(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Assignment title"), "Loops and arrays");
  await user.type(screen.getByLabelText("Instructions for students"), "Answer every question.");
  await user.type(screen.getByLabelText("Question 1 text"), "What does a loop do?");
  await user.type(screen.getByLabelText("Question 1 maximum marks"), "5");
  await user.type(screen.getByLabelText("Question 1 marking rubric"), "Mentions repetition.");
}

describe("AssignmentForm", () => {
  it("submits the validated numbers, then shows a confirmation and clears the form", async () => {
    const onSubmit = vi.fn().mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    render(<AssignmentForm onSubmit={onSubmit} />);
    await fillFirst(user);
    await user.type(screen.getByLabelText(/Question 1 reference answer/), "Repeats code.");
    await user.click(screen.getByRole("button", { name: "Create assignment" }));
    expect(onSubmit).toHaveBeenCalledWith({
      title: "Loops and arrays",
      instructions: "Answer every question.",
      questions: [{ text: "What does a loop do?", maxMarks: 5, rubric: "Mentions repetition.", referenceAnswer: "Repeats code." }],
    });
    expect(await screen.findByRole("status")).toHaveTextContent("Loops and arrays");
    expect(screen.getByLabelText("Assignment title")).toHaveValue("");
  });

  it("shows field errors and sends nothing when the form is invalid", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<AssignmentForm onSubmit={onSubmit} />);
    await user.click(screen.getByRole("button", { name: "Create assignment" }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getAllByRole("alert").length).toBeGreaterThanOrEqual(4);
    expect(screen.getByLabelText("Assignment title")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("Question 1 maximum marks")).toHaveAttribute("aria-invalid", "true");
  });

  it("adds and removes questions, keeps at least one, and totals the marks", async () => {
    const user = userEvent.setup();
    render(<AssignmentForm onSubmit={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /Remove question/ })).not.toBeInTheDocument();
    await user.type(screen.getByLabelText("Question 1 maximum marks"), "5");
    await user.click(screen.getByRole("button", { name: "Add question" }));
    await user.type(screen.getByLabelText("Question 2 maximum marks"), "2.5");
    expect(screen.getByText(/Total:/)).toHaveTextContent("Total: 7.5 marks");
    await user.click(screen.getByRole("button", { name: "Remove question 1" }));
    expect(screen.getByText(/Total:/)).toHaveTextContent("Total: 2.5 marks");
    expect(screen.getAllByRole("group")).toHaveLength(1);
    expect(screen.getByLabelText("Question 1 maximum marks")).toHaveValue("2.5"); // question 2 became 1
  });

  it("stops adding at 20 questions", async () => {
    const user = userEvent.setup();
    render(<AssignmentForm onSubmit={vi.fn()} />);
    for (let i = 0; i < 19; i++) await user.click(screen.getByRole("button", { name: "Add question" }));
    expect(screen.getAllByRole("group")).toHaveLength(20);
    expect(screen.getByRole("button", { name: "Add question" })).toBeDisabled();
  });

  it("shows the server's message and field errors, and keeps what was typed", async () => {
    const onSubmit = vi.fn().mockResolvedValue({
      ok: false,
      message: "Please fix the highlighted fields.",
      errors: { question: { 0: { rubric: "Server says no." } } },
    });
    const user = userEvent.setup();
    render(<AssignmentForm onSubmit={onSubmit} />);
    await fillFirst(user);
    await user.click(screen.getByRole("button", { name: "Create assignment" }));
    expect(await screen.findByText("Please fix the highlighted fields.")).toBeInTheDocument();
    expect(screen.getByText("Server says no.")).toBeInTheDocument();
    expect(screen.getByLabelText("Assignment title")).toHaveValue("Loops and arrays");
  });

  it("explains a network failure and does not double-submit", async () => {
    let fail: (e: Error) => void = () => {};
    const onSubmit = vi.fn().mockReturnValue(new Promise((_, reject) => (fail = reject)));
    const user = userEvent.setup();
    render(<AssignmentForm onSubmit={onSubmit} />);
    await fillFirst(user);
    await user.click(screen.getByRole("button", { name: "Create assignment" }));
    expect(screen.getByRole("button", { name: "Creating…" })).toBeDisabled();
    fail(new Error("network"));
    expect(await screen.findByText(/Could not reach the server/)).toBeInTheDocument();
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});
