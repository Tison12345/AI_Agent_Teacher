import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { StudentDetail } from "@/lib/students/types";

const api = vi.hoisted(() => ({ fetchStudent: vi.fn() }));
vi.mock("@/lib/api/client", () => api);

import { FacultyStudentDetail } from "./FacultyStudentDetail";

const ASHA = "11111111-1111-4111-8111-111111111111";
const E1 = "00000000-0000-4000-9000-000000000001";
const E2 = "00000000-0000-4000-9000-000000000002";

const detail = (over: Partial<StudentDetail> = {}): StudentDetail => ({
  summary: {
    id: ASHA,
    name: "Asha Fictional",
    email: "asha@gmail.com",
    joinedAt: "2026-10-01T10:00:00+00:00",
    projectCount: 2,
    weeksRecorded: 3,
    assignmentsSubmitted: 3,
    weeklyPending: 1,
    assignmentPending: 1,
    averageOfficial: 73.3,
    projectAverage: 70,
    assignmentAverage: 80,
  },
  projects: [
    {
      id: "p1",
      title: "Library app",
      repoUrl: "https://github.com/asha/library",
      durationWeeks: 12,
      createdAt: "2026-10-05T10:00:00+00:00",
      averageOfficial: 80,
      pending: 1,
      weeks: [
        { weekNumber: 1, checkpointId: "c1", recordedAt: "2026-10-10T10:00:00+00:00", filesChanged: 4, additions: 40, deletions: 5, quizCreated: true, quiz: { correctCount: 4, total: 5 }, evaluation: { id: E1, status: "approved", aiScore: 85, officialScore: 80, confidence: "high", decidedAt: "2026-10-11T10:00:00+00:00" } },
        { weekNumber: 2, checkpointId: "c2", recordedAt: "2026-10-17T10:00:00+00:00", filesChanged: 1, additions: 3, deletions: 0, quizCreated: false, quiz: null, evaluation: { id: E2, status: "pending_review", aiScore: 90, officialScore: null, confidence: "medium", decidedAt: null } },
      ],
    },
    {
      id: "p2",
      title: "Chat app",
      repoUrl: "https://github.com/asha/chat",
      durationWeeks: 4,
      createdAt: "2026-10-06T10:00:00+00:00",
      averageOfficial: null,
      pending: 0,
      weeks: [],
    },
  ],
  assignments: [
    { submissionId: "s2", assignmentId: "a2", assignmentTitle: "Functions", maxMarks: 10, status: "awaiting_review", fileName: "b.docx", submittedAt: "2026-10-21T10:00:00+00:00", aiTotal: 8, officialTotal: null, feedback: null, decidedAt: null, error: null },
    { submissionId: "s1", assignmentId: "a1", assignmentTitle: "Loops and arrays", maxMarks: 15, status: "approved", fileName: "a.pdf", submittedAt: "2026-10-20T10:00:00+00:00", aiTotal: 14, officialTotal: 12, feedback: "Good work on loops.", decidedAt: "2026-10-22T10:00:00+00:00", error: null },
    { submissionId: "s3", assignmentId: "a4", assignmentTitle: "Sorting", maxMarks: 10, status: "failed", fileName: "c.pdf", submittedAt: "2026-10-19T10:00:00+00:00", aiTotal: null, officialTotal: null, feedback: null, decidedAt: null, error: "Marking could not be completed." },
    { submissionId: "s4", assignmentId: "a5", assignmentTitle: "Trees", maxMarks: 10, status: "needs_ocr", fileName: "d.pdf", submittedAt: "2026-10-18T10:00:00+00:00", aiTotal: null, officialTotal: null, feedback: null, decidedAt: null, error: "This looks like a scanned PDF." },
    { submissionId: "s5", assignmentId: "a6", assignmentTitle: "Graphs", maxMarks: 10, status: "rejected", fileName: "e.pdf", submittedAt: "2026-10-17T10:00:00+00:00", aiTotal: 3, officialTotal: null, feedback: null, decidedAt: "2026-10-23T10:00:00+00:00", error: null },
    { submissionId: "s6", assignmentId: "a7", assignmentTitle: "Hashing", maxMarks: 10, status: "edited", fileName: "f.pdf", submittedAt: "2026-10-16T10:00:00+00:00", aiTotal: 7, officialTotal: 9, feedback: "Edited feedback.", decidedAt: "2026-10-24T10:00:00+00:00", error: null },
    { submissionId: "s7", assignmentId: "a8", assignmentTitle: "Queues", maxMarks: 10, status: "processing", fileName: "g.pdf", submittedAt: "2026-10-15T10:00:00+00:00", aiTotal: null, officialTotal: null, feedback: null, decidedAt: null, error: null },
    { submissionId: null, assignmentId: "a3", assignmentTitle: "Recursion", maxMarks: 20, status: "not_submitted", fileName: null, submittedAt: null, aiTotal: null, officialTotal: null, feedback: null, decidedAt: null, error: null },
  ],
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  api.fetchStudent.mockResolvedValue(detail());
});

const setup = async () => {
  const view = render(<FacultyStudentDetail id={ASHA} />);
  await screen.findByRole("heading", { level: 1, name: "Asha Fictional" });
  return { user: userEvent.setup(), ...view };
};

describe("FacultyStudentDetail", () => {
  it("shows the student's name, email and score summary from the real numbers", async () => {
    await setup();
    expect(api.fetchStudent).toHaveBeenCalledWith(ASHA);
    expect(screen.getByText("asha@gmail.com")).toBeInTheDocument();
    const summary = screen.getByRole("region", { name: "Score summary" });
    expect(summary).toHaveTextContent("Average official score73.3%");
    expect(summary).toHaveTextContent("Project average70%");
    expect(summary).toHaveTextContent("Assignment average80%");
    expect(summary).toHaveTextContent("Pending reviews2");
    expect(summary).toHaveTextContent("1 weekly, 1 assignment");
  });

  it("lists the projects with a GitHub link, and the weekly history with the AI recommendation next to the official score", async () => {
    await setup();
    const repo = screen.getByRole("link", { name: /asha\/library/ });
    expect(repo).toHaveAttribute("href", "https://github.com/asha/library");
    expect(repo).toHaveAttribute("target", "_blank");
    expect(repo).toHaveAttribute("rel", expect.stringContaining("noopener"));

    const table = screen.getByRole("table", { name: "Weekly checkpoints for Library app" });
    const [week1, week2] = within(table).getAllByRole("row").slice(1);
    // Week 1: the AI said 85 (labelled not official), the faculty made it 80, and the quiz was taken.
    expect(week1).toHaveTextContent("4 files (+40 −5)");
    expect(week1).toHaveTextContent("85not official");
    expect(within(week1).getAllByRole("cell")[3]).toHaveTextContent("80");
    expect(week1).toHaveTextContent("Approved");
    expect(week1).toHaveTextContent("4/5 correct");
    // Week 2: only the AI's recommendation exists, so the official score is a dash.
    expect(week2).toHaveTextContent("90not official");
    expect(within(week2).getAllByRole("cell")[3]).toHaveTextContent("–");
    expect(week2).toHaveTextContent("Waiting for review");
    expect(week2).toHaveTextContent("No quiz");
  });

  it("links a week directly to its existing review page, with Review for pending and Open for decided", async () => {
    await setup();
    const table = screen.getByRole("table", { name: "Weekly checkpoints for Library app" });
    const [week1, week2] = within(table).getAllByRole("row").slice(1);
    expect(within(week1).getByRole("link", { name: /Open/ })).toHaveAttribute("href", `/faculty/evaluations/${E1}`);
    expect(within(week2).getByRole("link", { name: /Review/ })).toHaveAttribute("href", `/faculty/evaluations/${E2}`);
  });

  it("shows every assignment status: not submitted, processing, awaiting review, approved, edited, rejected, failed, needs OCR", async () => {
    await setup();
    const table = screen.getByRole("table", { name: "Assignment submissions" });
    const text = (title: string) => within(table).getByRole("row", { name: new RegExp(title) });
    expect(text("Recursion")).toHaveTextContent("Not submitted");
    expect(text("Queues")).toHaveTextContent("Processing");
    expect(text("Functions")).toHaveTextContent("Awaiting faculty review");
    expect(text("Loops and arrays")).toHaveTextContent("Approved");
    expect(text("Hashing")).toHaveTextContent("Edited");
    expect(text("Graphs")).toHaveTextContent("Rejected");
    expect(text("Sorting")).toHaveTextContent("Failed");
    expect(text("Sorting")).toHaveTextContent("Marking could not be completed.");
    expect(text("Trees")).toHaveTextContent("Needs OCR");
    expect(text("Trees")).toHaveTextContent("This looks like a scanned PDF.");
  });

  it("keeps the AI's marks apart from the official marks, and shows the feedback the student sees", async () => {
    await setup();
    const loops = within(screen.getByRole("table", { name: "Assignment submissions" })).getByRole("row", { name: /Loops and arrays/ });
    const cells = within(loops).getAllByRole("cell");
    expect(cells[2]).toHaveTextContent("14/15not official"); // the AI's recommendation
    expect(cells[3]).toHaveTextContent("12/15"); // the official marks
    expect(cells[4]).toHaveTextContent("Good work on loops.");
    const pending = within(screen.getByRole("table", { name: "Assignment submissions" })).getByRole("row", { name: /Functions/ });
    expect(within(pending).getAllByRole("cell")[3]).toHaveTextContent("–"); // nothing official yet
  });

  it("links a submission directly to the existing review page", async () => {
    await setup();
    const table = screen.getByRole("table", { name: "Assignment submissions" });
    expect(within(within(table).getByRole("row", { name: /Functions/ })).getByRole("link", { name: /Review/ })).toHaveAttribute("href", "/faculty/submissions/s2");
    expect(within(within(table).getByRole("row", { name: /Loops and arrays/ })).getByRole("link", { name: /Open/ })).toHaveAttribute("href", "/faculty/submissions/s1");
    expect(within(within(table).getByRole("row", { name: /Recursion/ })).queryByRole("link")).not.toBeInTheDocument(); // nothing to review
  });

  it("lists what is waiting for review at the top, with direct Review links", async () => {
    await setup();
    const pending = screen.getByRole("region", { name: "Waiting for your review" });
    expect(pending).toHaveTextContent("Library app, week 2");
    expect(pending).toHaveTextContent("AI recommendation 90/100 (not official)");
    expect(within(pending).getAllByRole("link").map((l) => l.getAttribute("href"))).toEqual([`/faculty/evaluations/${E2}`, "/faculty/submissions/s2"]);
  });

  it("draws score charts with both the official and the AI bars labelled, for projects, weeks and assignments", async () => {
    await setup();
    const charts = screen.getByRole("heading", { name: "Performance" }).closest("section")!;
    expect(within(charts).getByRole("group", { name: "Project-wise average" })).toBeInTheDocument();
    expect(within(charts).getByRole("group", { name: "Week-wise scores for Library app" })).toBeInTheDocument();
    expect(within(charts).getByRole("group", { name: "Assignment marks" })).toBeInTheDocument();
    expect(within(charts).getAllByText("Official (faculty-approved)").length).toBeGreaterThan(0);
    expect(within(charts).getAllByText("AI recommendation (not official)").length).toBeGreaterThan(0);
    expect(within(charts).getByRole("img", { name: "Week 1 official: 80" })).toBeInTheDocument();
    expect(within(charts).getByRole("img", { name: "Week 1 AI recommendation: 85" })).toBeInTheDocument();
    expect(within(charts).getByRole("img", { name: "Week 2 official: none" })).toBeInTheDocument(); // a missing score is not a zero
  });

  it("switches the week-wise chart between the student's projects", async () => {
    const data = detail();
    data.projects[1].weeks = [
      { weekNumber: 1, checkpointId: "c9", recordedAt: "2026-10-12T10:00:00+00:00", filesChanged: 1, additions: 1, deletions: 0, quizCreated: false, quiz: null, evaluation: { id: "e9", status: "edited", aiScore: 75, officialScore: 60, confidence: "high", decidedAt: "2026-10-13T10:00:00+00:00" } },
    ];
    api.fetchStudent.mockResolvedValue(data);
    const { user } = await setup();
    await user.selectOptions(screen.getByRole("combobox", { name: "Project for the week-wise chart" }), "p2");
    expect(screen.getByRole("group", { name: "Week-wise scores for Chat app" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Week 1 official: 60" })).toBeInTheDocument();
  });

  it("a student with nothing yet shows empty states, not charts or invented numbers", async () => {
    api.fetchStudent.mockResolvedValue(
      detail({
        summary: { ...detail().summary, projectCount: 0, weeksRecorded: 0, assignmentsSubmitted: 0, weeklyPending: 0, assignmentPending: 0, averageOfficial: null, projectAverage: null, assignmentAverage: null },
        projects: [],
        assignments: [],
      }),
    );
    await setup();
    expect(screen.getByText("This student has not created a project yet.")).toBeInTheDocument();
    expect(screen.getByText("There are no assignments yet.")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Performance" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Waiting for your review" })).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Score summary" })).toHaveTextContent("Average official score–no approved scores yet");
  });

  it("explains the unassigned group instead of pretending it is a student", async () => {
    api.fetchStudent.mockResolvedValue(detail({ summary: { ...detail().summary, id: "unassigned", name: "Unassigned (before accounts)", email: null, joinedAt: null } }));
    render(<FacultyStudentDetail id="unassigned" />);
    expect(await screen.findByRole("note")).toHaveTextContent("could not be linked to a student");
  });

  it("says when the student does not exist, and offers a retry after an error", async () => {
    api.fetchStudent.mockResolvedValueOnce(null);
    const { unmount } = render(<FacultyStudentDetail id={ASHA} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("This student does not exist.");
    unmount();

    api.fetchStudent.mockRejectedValueOnce(new Error("Storage is not configured on the server."));
    const user = userEvent.setup();
    render(<FacultyStudentDetail id={ASHA} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Storage is not configured");
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Asha Fictional" })).toBeInTheDocument();
  });

  it("links back to the dashboard", async () => {
    await setup();
    expect(screen.getByRole("link", { name: /Back to the dashboard/ })).toHaveAttribute("href", "/faculty");
  });
});
