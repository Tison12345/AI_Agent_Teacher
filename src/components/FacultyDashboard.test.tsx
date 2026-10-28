import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Project } from "@/lib/schemas/project";
import type { QueueItem } from "@/lib/schemas/review";
import type { StudentList } from "@/lib/students/types";

const api = vi.hoisted(() => ({ fetchQueue: vi.fn(), fetchProjects: vi.fn(), fetchStudents: vi.fn(), fetchStudent: vi.fn() }));
vi.mock("@/lib/api/client", () => api);

import { FacultyDashboard } from "./FacultyDashboard";

const P1 = "123e4567-e89b-42d3-a456-426614174000";
const item = (over: Partial<QueueItem> = {}): QueueItem => ({
  evaluationId: "00000000-0000-4000-9000-000000000001",
  projectId: P1,
  projectTitle: "Library app",
  weekNumber: 1,
  status: "pending_review",
  suggestedScore: 90,
  officialScore: null,
  confidence: "high",
  quiz: { status: "not_created", correctCount: null, total: null },
  createdAt: "2026-10-26T10:00:00+00:00",
  ...over,
});
const project: Project = {
  id: P1,
  title: "Library app",
  description: "A description that is long enough.",
  repoUrl: "https://github.com/o/r",
  durationWeeks: 4,
  createdAt: "2026-10-25T12:00:00+00:00",
};
const students: StudentList = {
  overview: { totalStudents: 2, totalProjects: 1, assignmentsSubmitted: 3, assignmentsAwaitingReview: 1, weeklyAwaitingReview: 1, overallAverage: 73.3, studentsWithScores: 1 },
  students: [
    { id: "11111111-1111-4111-8111-111111111111", name: "Asha Fictional", email: "asha@gmail.com", joinedAt: "2026-10-01T10:00:00+00:00", projectCount: 1, weeksRecorded: 2, assignmentsSubmitted: 3, weeklyPending: 1, assignmentPending: 1, averageOfficial: 73.3, projectAverage: 70, assignmentAverage: 80 },
    { id: "22222222-2222-4222-8222-222222222222", name: "Bala Fictional", email: "bala@gmail.com", joinedAt: "2026-10-02T10:00:00+00:00", projectCount: 0, weeksRecorded: 0, assignmentsSubmitted: 0, weeklyPending: 0, assignmentPending: 0, averageOfficial: null, projectAverage: null, assignmentAverage: null },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  api.fetchStudents.mockResolvedValue(students);
  api.fetchQueue.mockResolvedValue([item()]);
  api.fetchProjects.mockResolvedValue([project]);
});

describe("FacultyDashboard", () => {
  it("loads the students, the evaluations and the projects once, then shows the class overview, the student list and the project sections below", async () => {
    render(<FacultyDashboard />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading dashboard");
    expect(await screen.findByRole("region", { name: "Class overview" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Students" })).toBeInTheDocument();
    // The existing project overview is still here, below the students.
    expect(screen.getByRole("heading", { name: "Projects and reviews" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Analytics" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Projects" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Evaluations" })).toBeInTheDocument();
    expect(api.fetchStudents).toHaveBeenCalledTimes(1);
    expect(api.fetchQueue).toHaveBeenCalledWith("all");
    expect(api.fetchProjects).toHaveBeenCalledTimes(1);
  });

  it("puts the students before the project sections", async () => {
    render(<FacultyDashboard />);
    const studentsHeading = await screen.findByRole("heading", { name: "Students" });
    const projectsHeading = screen.getByRole("heading", { name: "Projects and reviews" });
    expect(studentsHeading.compareDocumentPosition(projectsHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("shows the six overview numbers from the real data", async () => {
    render(<FacultyDashboard />);
    const overview = await screen.findByRole("region", { name: "Class overview" });
    expect(overview).toHaveTextContent("Total students2");
    expect(overview).toHaveTextContent("Projects submitted1");
    expect(overview).toHaveTextContent("Assignments submitted3");
    expect(overview).toHaveTextContent("Assignments to review1");
    expect(overview).toHaveTextContent("Weekly evaluations to review1");
    expect(overview).toHaveTextContent("Average official score73.3%");
  });

  it("changing the evaluation filter does not ask the server again", async () => {
    const user = userEvent.setup();
    render(<FacultyDashboard />);
    await screen.findByRole("region", { name: "Class overview" });
    await user.click(screen.getByRole("button", { name: /^Approved/ }));
    expect(api.fetchQueue).toHaveBeenCalledTimes(1);
    expect(api.fetchStudents).toHaveBeenCalledTimes(1);
  });

  it("shows an error with retry, and recovers", async () => {
    api.fetchStudents.mockRejectedValueOnce(new Error("Storage is not configured on the server."));
    const user = userEvent.setup();
    render(<FacultyDashboard />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Storage is not configured");
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("region", { name: "Class overview" })).toBeInTheDocument();
  });

  it("shows empty states, not invented numbers, when there is no data at all", async () => {
    api.fetchStudents.mockResolvedValue({
      overview: { totalStudents: 0, totalProjects: 0, assignmentsSubmitted: 0, assignmentsAwaitingReview: 0, weeklyAwaitingReview: 0, overallAverage: null, studentsWithScores: 0 },
      students: [],
    });
    api.fetchQueue.mockResolvedValue([]);
    api.fetchProjects.mockResolvedValue([]);
    render(<FacultyDashboard />);
    const overview = await screen.findByRole("region", { name: "Class overview" });
    expect(overview).toHaveTextContent("Average official score–");
    expect(overview).toHaveTextContent("no approved scores yet");
    expect(screen.getByText(/No student has signed up yet/)).toBeInTheDocument();
    expect(screen.getByText(/Charts appear here once/)).toBeInTheDocument();
    expect(screen.getByText("No projects have been created yet.")).toBeInTheDocument();
    expect(screen.getByText("Nothing is waiting for review.")).toBeInTheDocument();
  });
});
