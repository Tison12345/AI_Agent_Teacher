import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { FacultyAssignment, StudentAssignment } from "@/lib/schemas/assignment";

const api = vi.hoisted(() => ({
  fetchStudentAssignments: vi.fn(),
  fetchStudentAssignment: vi.fn(),
  fetchFacultyAssignments: vi.fn(),
  fetchFacultyAssignment: vi.fn(),
  createAssignment: vi.fn(),
}));
vi.mock("@/lib/api/client", () => api);

import { FacultyAssignmentDetail } from "./FacultyAssignmentDetail";
import { FacultyAssignments } from "./FacultyAssignments";
import { StudentAssignmentDetail } from "./StudentAssignmentDetail";
import { StudentAssignments } from "./StudentAssignments";

const ID = "123e4567-e89b-42d3-a456-426614174000";
const questions = [
  { number: 1, text: "What does a loop do?", maxMarks: 5, rubric: "Mentions repetition." },
  { number: 2, text: "What is an array?", maxMarks: 2.5, rubric: "Ordered values." },
];
const student: StudentAssignment = {
  id: ID,
  title: "Loops and arrays",
  instructions: "Answer every question.",
  questions,
  maxMarks: 7.5,
  createdAt: "2026-10-27T10:00:00+00:00",
};
const faculty: FacultyAssignment = {
  ...student,
  submissionCount: 3,
  hasReferenceAnswers: true,
  referenceAnswers: { "1": "It repeats a block of code." },
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("StudentAssignments", () => {
  it("lists assignments with question count and marks, linking to the detail page", async () => {
    api.fetchStudentAssignments.mockResolvedValue([student]);
    render(<StudentAssignments />);
    const link = await screen.findByRole("link", { name: /Loops and arrays/ });
    expect(link).toHaveAttribute("href", `/student/assignments/${ID}`);
    expect(screen.getByText("2 questions")).toBeInTheDocument();
    expect(screen.getByText("7.5 marks")).toBeInTheDocument();
  });

  it("shows an empty state, an error with retry, and loading", async () => {
    api.fetchStudentAssignments.mockResolvedValueOnce([]).mockRejectedValueOnce(new Error("Storage is not configured.")).mockResolvedValueOnce([student]);
    const { unmount } = render(<StudentAssignments />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading assignments");
    expect(await screen.findByText("No assignments yet")).toBeInTheDocument();
    unmount();
    const user = userEvent.setup();
    render(<StudentAssignments />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Storage is not configured.");
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("link", { name: /Loops and arrays/ })).toBeInTheDocument();
  });
});

describe("StudentAssignmentDetail", () => {
  it("shows instructions, questions, marks and rubric, and no reference answers", async () => {
    api.fetchStudentAssignment.mockResolvedValue(student);
    render(<StudentAssignmentDetail id={ID} />);
    expect(await screen.findByRole("heading", { level: 1, name: "Loops and arrays" })).toBeInTheDocument();
    expect(screen.getByText("Answer every question.")).toBeInTheDocument();
    expect(screen.getByText("1. What does a loop do?")).toBeInTheDocument();
    expect(screen.getByText("5 marks")).toBeInTheDocument();
    expect(screen.getByText("Mentions repetition.")).toBeInTheDocument();
    expect(screen.queryByText(/Reference answer/)).not.toBeInTheDocument();
  });

  it("says when the assignment does not exist", async () => {
    api.fetchStudentAssignment.mockResolvedValue(null);
    render(<StudentAssignmentDetail id={ID} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("This assignment does not exist.");
  });
});

describe("FacultyAssignments", () => {
  const summary = { ...faculty, referenceAnswers: undefined };

  it("shows the demo notice, summary cards, and each assignment with its submission count", async () => {
    api.fetchFacultyAssignments.mockResolvedValue([summary]);
    render(<FacultyAssignments />);
    expect(screen.getByText(/Demo build, no login/)).toBeInTheDocument();
    const cards = await screen.findByRole("region", { name: "Summary" });
    expect(cards).toHaveTextContent("Assignments1");
    expect(cards).toHaveTextContent("Questions2");
    expect(cards).toHaveTextContent("Submissions3");
    const link = screen.getByRole("link", { name: /Loops and arrays/ });
    expect(link).toHaveAttribute("href", `/faculty/assignments/${ID}`);
    const card = link.closest("article")!;
    expect(card).toHaveTextContent("3 submissions");
    expect(card).toHaveTextContent("7.5 marks");
    expect(card).toHaveTextContent("Has reference answers");
  });

  it("with no assignments the create form is open and the totals are zero", async () => {
    api.fetchFacultyAssignments.mockResolvedValue([]);
    render(<FacultyAssignments />);
    expect(await screen.findByText(/No assignments yet/)).toBeInTheDocument();
    expect(screen.getByLabelText("Assignment title")).toBeVisible();
    expect(screen.getByRole("region", { name: "Summary" })).toHaveTextContent("Assignments0");
  });

  it("keeps the form closed when assignments exist, and opens it from the button", async () => {
    api.fetchFacultyAssignments.mockResolvedValue([summary]);
    const user = userEvent.setup();
    render(<FacultyAssignments />);
    await screen.findByRole("link", { name: /Loops and arrays/ });
    expect(screen.getByLabelText("Assignment title")).not.toBeVisible();
    await user.click(screen.getByRole("button", { name: "New assignment" }));
    expect(screen.getByLabelText("Assignment title")).toBeVisible();
  });

  it("a newly created assignment appears at once, with zero submissions", async () => {
    api.fetchFacultyAssignments.mockResolvedValue([]);
    api.createAssignment.mockResolvedValue({
      result: { ok: true },
      assignment: { ...faculty, submissionCount: 0, title: "Brand new" },
    });
    const user = userEvent.setup();
    render(<FacultyAssignments />);
    await screen.findByText(/No assignments yet/);
    await user.type(screen.getByLabelText("Assignment title"), "Brand new");
    await user.type(screen.getByLabelText("Instructions for students"), "Do it.");
    await user.type(screen.getByLabelText("Question 1 text"), "Why?");
    await user.type(screen.getByLabelText("Question 1 maximum marks"), "4");
    await user.type(screen.getByLabelText("Question 1 marking rubric"), "A reason.");
    await user.click(screen.getByRole("button", { name: "Create assignment" }));
    const link = await screen.findByRole("link", { name: /Brand new/ });
    expect(within(link.closest("article")!).getByText("0 submissions")).toBeInTheDocument();
    expect(api.createAssignment).toHaveBeenCalledWith(expect.objectContaining({ title: "Brand new" }));
  });

  it("shows an error with retry", async () => {
    api.fetchFacultyAssignments.mockRejectedValueOnce(new Error("down")).mockResolvedValueOnce([]);
    const user = userEvent.setup();
    render(<FacultyAssignments />);
    expect(await screen.findByRole("alert")).toHaveTextContent("down");
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText(/No assignments yet/)).toBeInTheDocument();
  });
});

describe("FacultyAssignmentDetail", () => {
  it("shows the questions, rubric and reference answers (faculty only), and the submission count", async () => {
    api.fetchFacultyAssignment.mockResolvedValue(faculty);
    render(<FacultyAssignmentDetail id={ID} />);
    expect(await screen.findByRole("heading", { level: 1, name: "Loops and arrays" })).toBeInTheDocument();
    expect(screen.getByText(/Demo build, no login/)).toBeInTheDocument();
    expect(screen.getByText("It repeats a block of code.")).toBeInTheDocument();
    expect(screen.getByText("Reference answer (faculty only)")).toBeInTheDocument();
    expect(screen.getAllByText("Reference answer (faculty only)")).toHaveLength(1); // only question 1 has one
    expect(screen.getByText("3 submissions received.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Back to assignments/ })).toHaveAttribute("href", "/faculty/assignments");
  });

  it("says when nobody has submitted, and when the assignment is missing", async () => {
    api.fetchFacultyAssignment.mockResolvedValueOnce({ ...faculty, submissionCount: 0 }).mockResolvedValueOnce(null);
    const { unmount } = render(<FacultyAssignmentDetail id={ID} />);
    expect(await screen.findByText("No student has submitted an answer yet.")).toBeInTheDocument();
    unmount();
    render(<FacultyAssignmentDetail id={ID} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("This assignment does not exist.");
  });
});
