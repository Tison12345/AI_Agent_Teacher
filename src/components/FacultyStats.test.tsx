import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { QueueItem } from "@/lib/schemas/review";

const api = vi.hoisted(() => ({ fetchQueue: vi.fn() }));
vi.mock("@/lib/api/client", () => api);

import { FacultyStats } from "./FacultyStats";

const P1 = "123e4567-e89b-42d3-a456-426614174000";
const P2 = "223e4567-e89b-42d3-a456-426614174000";
let n = 0;
const item = (over: Partial<QueueItem> = {}): QueueItem => ({
  evaluationId: `00000000-0000-4000-9000-${String(++n).padStart(12, "0")}`,
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

beforeEach(() => {
  vi.clearAllMocks();
  n = 0;
});

describe("FacultyStats", () => {
  it("asks for every evaluation, whatever the list below is filtered to", async () => {
    api.fetchQueue.mockResolvedValue([]);
    render(<FacultyStats />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading summary");
    await screen.findByRole("region", { name: "Pending reviews" });
    expect(api.fetchQueue).toHaveBeenCalledWith("all");
  });

  it("with nothing yet: no average is invented and nothing is pending", async () => {
    api.fetchQueue.mockResolvedValue([]);
    render(<FacultyStats />);
    const average = await screen.findByRole("region", { name: "Average official score" });
    expect(average).toHaveTextContent("No reviewed weeks yet");
    expect(average.textContent).not.toMatch(/\d/);
    expect(screen.getByRole("region", { name: "Pending reviews" })).toHaveTextContent("All caught up");
  });

  it("averages only official scores: the AI's suggestion and rejected weeks never count", async () => {
    api.fetchQueue.mockResolvedValue([
      item({ weekNumber: 1, status: "approved", suggestedScore: 100, officialScore: 80 }),
      item({ weekNumber: 2, status: "edited", suggestedScore: 100, officialScore: 60 }),
      item({ weekNumber: 3, status: "rejected", suggestedScore: 100, officialScore: null }),
      item({ weekNumber: 4, status: "pending_review", suggestedScore: 100 }),
    ]);
    render(<FacultyStats />);
    const average = await screen.findByRole("region", { name: "Average official score" });
    expect(within(average).getByLabelText("Average official score: 70 out of 100")).toBeInTheDocument();
    expect(average).toHaveTextContent("Across 2 reviewed weeks in 1 project.");
    expect(average).toHaveTextContent("never the AI's");
  });

  it("compares weeks: the average official score of each week number across projects", async () => {
    api.fetchQueue.mockResolvedValue([
      item({ projectId: P1, weekNumber: 1, status: "approved", officialScore: 80 }),
      item({ projectId: P2, projectTitle: "Other", weekNumber: 1, status: "approved", officialScore: 60 }),
      item({ projectId: P1, weekNumber: 2, status: "approved", officialScore: 90 }),
    ]);
    render(<FacultyStats />);
    const bars = await screen.findByRole("group", { name: "Official result by week" });
    expect(bars).toHaveTextContent("W1: 70 out of 100");
    expect(bars).toHaveTextContent("W2: 90 out of 100");
    expect(bars).not.toHaveTextContent("W3");
  });

  it("counts pending reviews, projects, reviewed weeks and quizzes from the real data", async () => {
    api.fetchQueue.mockResolvedValue([
      item({ weekNumber: 1, status: "pending_review", quiz: { status: "taken", correctCount: 1, total: 5 } }),
      item({ weekNumber: 2, status: "pending_review", quiz: { status: "not_taken", correctCount: null, total: null } }),
      item({ projectId: P2, projectTitle: "Other", weekNumber: 1, status: "approved", officialScore: 50, quiz: { status: "taken", correctCount: 3, total: 5 } }),
    ]);
    render(<FacultyStats />);
    const pending = await screen.findByRole("region", { name: "Pending reviews" });
    expect(pending).toHaveTextContent("2weeks");
    expect(pending).toHaveTextContent("2 to review");
    // Projects, reviewed weeks, quizzes taken, quiz average.
    expect(screen.getByText("Projects").parentElement).toHaveTextContent("2");
    expect(screen.getByText("Reviewed weeks").parentElement).toHaveTextContent("1");
    expect(screen.getByText("Quizzes taken").parentElement).toHaveTextContent("2");
    expect(screen.getByText("Quizzes taken").parentElement).toHaveTextContent("of 3 created");
    expect(screen.getByText("Quiz average").parentElement).toHaveTextContent("40%"); // (1/5 + 3/5) / 2
  });

  it("shows a dash for the quiz average when nobody has taken a quiz", async () => {
    api.fetchQueue.mockResolvedValue([item()]);
    render(<FacultyStats />);
    await screen.findByRole("region", { name: "Pending reviews" });
    expect(screen.getByText("Quiz average").parentElement).toHaveTextContent("–");
  });

  it("says so, without breaking the page, when the summary cannot be loaded", async () => {
    api.fetchQueue.mockRejectedValue(new Error("down"));
    render(<FacultyStats />);
    expect(await screen.findByText(/summary could not be loaded/)).toBeInTheDocument();
  });
});
