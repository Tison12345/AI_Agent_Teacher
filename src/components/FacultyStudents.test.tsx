import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { StudentDetail, StudentSummary } from "@/lib/students/types";

const api = vi.hoisted(() => ({ fetchStudent: vi.fn() }));
vi.mock("@/lib/api/client", () => api);

import { StudentList, StudentOverviewCards } from "./FacultyStudents";

const ASHA = "11111111-1111-4111-8111-111111111111";
const BALA = "22222222-2222-4222-8222-222222222222";
const summary = (over: Partial<StudentSummary>): StudentSummary => ({
  id: ASHA,
  name: "Asha Fictional",
  email: "asha@gmail.com",
  joinedAt: "2026-10-01T10:00:00+00:00",
  projectCount: 2,
  weeksRecorded: 4,
  assignmentsSubmitted: 3,
  weeklyPending: 1,
  assignmentPending: 2,
  averageOfficial: 73.3,
  projectAverage: 70,
  assignmentAverage: 80,
  ...over,
});
const students = [
  summary({}),
  summary({ id: BALA, name: "Bala Fictional", email: "bala@gmail.com", projectCount: 1, assignmentsSubmitted: 0, weeklyPending: 0, assignmentPending: 0, averageOfficial: null }),
  summary({ id: "unassigned", name: "Unassigned (before accounts)", email: null, joinedAt: null, weeklyPending: 0, assignmentPending: 0 }),
];
const detail: StudentDetail = {
  summary: students[0],
  projects: [
    {
      id: "p1",
      title: "Library app",
      repoUrl: "https://github.com/asha/library.git",
      durationWeeks: 12,
      createdAt: "2026-10-05T10:00:00+00:00",
      weeks: [],
      averageOfficial: 80,
      pending: 1,
    },
  ],
  assignments: [
    { submissionId: "s1", assignmentId: "a1", assignmentTitle: "Loops", maxMarks: 15, status: "approved", fileName: "a.pdf", submittedAt: "2026-10-20T10:00:00+00:00", aiTotal: 14, officialTotal: 12, feedback: "Good.", decidedAt: null, error: null },
    { submissionId: "s2", assignmentId: "a2", assignmentTitle: "Functions", maxMarks: 10, status: "awaiting_review", fileName: "b.pdf", submittedAt: "2026-10-21T10:00:00+00:00", aiTotal: 8, officialTotal: null, feedback: null, decidedAt: null, error: null },
    { submissionId: null, assignmentId: "a3", assignmentTitle: "Recursion", maxMarks: 20, status: "not_submitted", fileName: null, submittedAt: null, aiTotal: null, officialTotal: null, feedback: null, decidedAt: null, error: null },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  api.fetchStudent.mockResolvedValue(detail);
});

describe("StudentOverviewCards", () => {
  const overview = { totalStudents: 3, totalProjects: 4, assignmentsSubmitted: 5, assignmentsAwaitingReview: 2, weeklyAwaitingReview: 1, overallAverage: 61.7, studentsWithScores: 2 };

  it("shows the six numbers it is given", () => {
    render(<StudentOverviewCards overview={overview} />);
    const cards = screen.getByRole("region", { name: "Class overview" });
    for (const text of ["Total students3", "Projects submitted4", "Assignments submitted5", "Assignments to review2", "Weekly evaluations to review1", "Average official score61.7%"]) {
      expect(cards).toHaveTextContent(text);
    }
    expect(cards).toHaveTextContent("across 2 students, approved results only");
  });

  it("shows a dash and a reason, not a number, when nothing has been approved yet", () => {
    render(<StudentOverviewCards overview={{ ...overview, overallAverage: null, studentsWithScores: 0 }} />);
    expect(screen.getByRole("region", { name: "Class overview" })).toHaveTextContent("Average official score–no approved scores yet");
  });
});

describe("StudentList", () => {
  it("shows each student on one scannable row: name, email, projects, assignments, pending reviews and average", () => {
    render(<StudentList students={students} />);
    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(3);
    const asha = rows[0];
    expect(asha).toHaveTextContent("Asha Fictional");
    expect(asha).toHaveTextContent("asha@gmail.com");
    expect(within(asha).getByText("Projects").nextSibling).toHaveTextContent("2");
    expect(within(asha).getByText("Assignments").nextSibling).toHaveTextContent("3");
    expect(within(asha).getByText("Pending").nextSibling).toHaveTextContent("3"); // 1 weekly + 2 assignment
    expect(within(asha).getByText("Avg score").nextSibling).toHaveTextContent("73.3%");
    expect(within(rows[1]).getByText("Avg score").nextSibling).toHaveTextContent("–"); // no score yet: a dash, not 0
    expect(rows[2]).toHaveTextContent("Created before accounts existed");
  });

  it("does not show the details until a student is opened, and fetches them only then", async () => {
    const user = userEvent.setup();
    render(<StudentList students={students} />);
    expect(api.fetchStudent).not.toHaveBeenCalled();
    expect(screen.queryByText("Library app")).not.toBeInTheDocument();
    const button = screen.getAllByRole("button", { expanded: false })[0];
    await user.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(api.fetchStudent).toHaveBeenCalledWith(ASHA);
    expect(await screen.findByText("Library app")).toBeInTheDocument();
    expect(screen.getByText("asha/library")).toBeInTheDocument();
  });

  it("the opened student shows where each assignment stands and links to the full profile", async () => {
    const user = userEvent.setup();
    render(<StudentList students={students} />);
    await user.click(screen.getAllByRole("button", { expanded: false })[0]);
    expect(await screen.findByText("Approved: 1")).toBeInTheDocument();
    expect(screen.getByText("Awaiting faculty review: 1")).toBeInTheDocument();
    expect(screen.getByText("Not submitted: 1")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Open full profile/ })).toHaveAttribute("href", `/faculty/students/${ASHA}`);
  });

  it("closes again, and a failed load can be retried", async () => {
    api.fetchStudent.mockRejectedValueOnce(new Error("Storage is not configured on the server."));
    const user = userEvent.setup();
    render(<StudentList students={students} />);
    const button = screen.getAllByRole("button", { expanded: false })[0];
    await user.click(button);
    expect(await screen.findByRole("alert")).toHaveTextContent("Storage is not configured");
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Library app")).toBeInTheDocument();
    await user.click(button);
    expect(screen.queryByText("Library app")).not.toBeInTheDocument();
  });

  it("searches by name or email, and says when nothing matches", async () => {
    const user = userEvent.setup();
    render(<StudentList students={students} />);
    const search = screen.getByRole("searchbox", { name: "Search students" });
    await user.type(search, "BALA@");
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByRole("status")).toHaveTextContent("Showing 1 of 3");
    await user.clear(search);
    await user.type(search, "asha");
    expect(screen.getAllByRole("listitem")[0]).toHaveTextContent("Asha Fictional");
    await user.clear(search);
    await user.type(search, "zzz");
    expect(screen.queryByRole("listitem")).not.toBeInTheDocument();
    expect(screen.getByText("No student matches that search.")).toBeInTheDocument();
  });

  it("can show only the students who have pending reviews", async () => {
    const user = userEvent.setup();
    render(<StudentList students={students} />);
    await user.click(screen.getByRole("checkbox", { name: "Pending reviews only" }));
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByRole("listitem")).toHaveTextContent("Asha Fictional");
  });

  it("says so when no student has signed up yet", () => {
    render(<StudentList students={[]} />);
    expect(screen.getByText(/No student has signed up yet/)).toBeInTheDocument();
  });
});
