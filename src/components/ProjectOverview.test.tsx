import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ProjectOverview as Overview, WeekOverview } from "@/lib/schemas/overview";

const api = vi.hoisted(() => ({ fetchProjectOverview: vi.fn() }));
vi.mock("@/lib/api/client", () => api);

import { ProjectOverview } from "./ProjectOverview";

const ID = "123e4567-e89b-42d3-a456-426614174000";
const EVAL = "00000000-0000-4000-9000-000000000001";

const week = (over: Partial<WeekOverview> = {}): WeekOverview => ({
  weekNumber: 1,
  title: "Plan the app",
  state: "not_recorded",
  recordedAt: null,
  evaluationId: null,
  suggestedScore: null,
  officialScore: null,
  teacherFeedback: null,
  teacherComment: null,
  ai: null,
  quiz: { status: "not_created", correctCount: null, total: null },
  ...over,
});

const decided = week({
  weekNumber: 1,
  state: "edited",
  recordedAt: "2026-10-26T10:00:00+00:00",
  evaluationId: EVAL,
  suggestedScore: 100,
  officialScore: 65,
  teacherFeedback: "Good start. Add a remove button.",
  teacherComment: "PRIVATE-REASON",
  ai: {
    confidence: "high",
    completed: ["Adding a book"],
    incomplete: ["Removing a book"],
    concerns: ["No error handling"],
    feedback: ["Add a remove button."],
  },
  quiz: { status: "taken", correctCount: 1, total: 5 },
});

const overview = (weeks: WeekOverview[]): Overview => ({
  project: {
    id: ID,
    title: "Library app",
    description: "A small app to keep track of books I read.",
    repoUrl: "https://github.com/octocat/hello-world",
    durationWeeks: weeks.length,
  },
  weeks,
});

beforeEach(() => {
  vi.clearAllMocks();
  api.fetchProjectOverview.mockResolvedValue(
    overview([
      decided,
      week({ weekNumber: 2, title: "Build the list", state: "pending_review", recordedAt: "2026-10-27T10:00:00+00:00", evaluationId: "00000000-0000-4000-9000-000000000002", suggestedScore: 71.5, ai: { confidence: "medium", completed: [], incomplete: [], concerns: [], feedback: [] } }),
      week({ weekNumber: 3, title: "Save the data", state: "not_evaluated", recordedAt: "2026-10-28T10:00:00+00:00" }),
      week({ weekNumber: 4, title: null }),
    ]),
  );
});

const card = (n: number) => screen.getByRole("heading", { name: new RegExp(`^Week ${n}\\b`) }).closest("li") as HTMLElement;

describe("ProjectOverview", () => {
  it("shows the project, how far it has got, and every week in order", async () => {
    render(<ProjectOverview id={ID} />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading project");
    expect(await screen.findByRole("heading", { level: 1, name: "Library app" })).toBeInTheDocument();
    expect(screen.getByText(/3 of 4 weeks recorded/)).toBeInTheDocument();
    expect(api.fetchProjectOverview).toHaveBeenCalledWith(ID);
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual([
      "Week 1 · Plan the app",
      "Week 2 · Build the list",
      "Week 3 · Save the data",
      "Week 4",
    ]);
    expect(screen.getByRole("link", { name: /Back to the faculty dashboard/ })).toHaveAttribute("href", "/faculty");
  });

  it("a decided week shows the official score apart from the AI's, the quiz, feedback and AI findings", async () => {
    render(<ProjectOverview id={ID} />);
    await screen.findByRole("heading", { level: 1 });
    const week1 = within(card(1));
    expect(week1.getByText("Official score").nextSibling).toHaveTextContent("65/100");
    expect(week1.getByText("AI recommendation (not official)").nextSibling).toHaveTextContent("100/100 · confidence high");
    expect(week1.getByText("Student quiz").nextSibling).toHaveTextContent("1/5 correct");
    expect(week1.getByText("Good start. Add a remove button.")).toBeInTheDocument();
    expect(week1.getByText("PRIVATE-REASON")).toBeInTheDocument(); // the teacher's own page
    expect(week1.getByText("Removing a book")).toBeInTheDocument();
    expect(week1.getByText("No error handling")).toBeInTheDocument();
    expect(week1.getByText("Edited")).toBeInTheDocument();
    expect(week1.getByRole("link", { name: /Open full review/ })).toHaveAttribute("href", `/faculty/evaluations/${EVAL}`);
  });

  it("a week waiting for review has no official score and says so", async () => {
    render(<ProjectOverview id={ID} />);
    await screen.findByRole("heading", { level: 1 });
    const week2 = within(card(2));
    expect(week2.getByText("Official score").nextSibling).toHaveTextContent("Waiting for your review");
    expect(week2.getByText("AI recommendation (not official)").nextSibling).toHaveTextContent("71.5/100");
    expect(week2.getByText("Student quiz").nextSibling).toHaveTextContent("Not started");
    expect(week2.getByRole("link", { name: /Review this week/ })).toBeInTheDocument();
    expect(week2.queryByText("Feedback shown to the student")).not.toBeInTheDocument();
  });

  it("a recorded week that was not evaluated has no review link, and an unrecorded one says so", async () => {
    render(<ProjectOverview id={ID} />);
    await screen.findByRole("heading", { level: 1 });
    const week3 = within(card(3));
    expect(week3.getByText("Recorded, not evaluated")).toBeInTheDocument();
    expect(week3.getByText("Official score").nextSibling).toHaveTextContent("Not evaluated yet");
    expect(week3.queryByRole("link")).not.toBeInTheDocument();
    const week4 = within(card(4));
    expect(week4.getByText("The student has not recorded this week yet.")).toBeInTheDocument();
    expect(week4.queryByText("Official score")).not.toBeInTheDocument();
  });

  it("a rejected week shows no official score", async () => {
    api.fetchProjectOverview.mockResolvedValue(
      overview([week({ state: "rejected", evaluationId: EVAL, recordedAt: "2026-10-26T10:00:00+00:00", suggestedScore: 90, teacherComment: "AI missed the main files" })]),
    );
    render(<ProjectOverview id={ID} />);
    await screen.findByRole("heading", { level: 1 });
    expect(screen.getByText("Official score").nextSibling).toHaveTextContent("None (rejected)");
    expect(screen.getByText("AI missed the main files")).toBeInTheDocument();
  });

  it("says when the project does not exist", async () => {
    api.fetchProjectOverview.mockResolvedValue(null);
    render(<ProjectOverview id={ID} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("This project does not exist.");
  });

  it("shows an error and retries", async () => {
    api.fetchProjectOverview.mockRejectedValueOnce(new Error("Storage is not configured on the server."));
    const user = userEvent.setup();
    render(<ProjectOverview id={ID} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Storage is not configured");
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Library app" })).toBeInTheDocument();
  });
});
