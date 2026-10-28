import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Project } from "@/lib/schemas/project";
import type { QueueItem } from "@/lib/schemas/review";

const api = vi.hoisted(() => ({ fetchQueue: vi.fn(), fetchProjects: vi.fn() }));
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

beforeEach(() => {
  vi.clearAllMocks();
  api.fetchQueue.mockResolvedValue([item()]);
  api.fetchProjects.mockResolvedValue([project]);
});

describe("FacultyDashboard", () => {
  it("loads every evaluation and every project once, then shows summary, analytics, projects and the queue", async () => {
    render(<FacultyDashboard />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading dashboard");
    expect(await screen.findByRole("region", { name: "Summary" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Analytics" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Projects" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Evaluations" })).toBeInTheDocument();
    expect(api.fetchQueue).toHaveBeenCalledTimes(1);
    expect(api.fetchQueue).toHaveBeenCalledWith("all");
    expect(api.fetchProjects).toHaveBeenCalledTimes(1);
  });

  it("changing the filter does not ask the server again", async () => {
    const user = userEvent.setup();
    render(<FacultyDashboard />);
    await screen.findByRole("region", { name: "Summary" });
    await user.click(screen.getByRole("button", { name: /^Approved/ }));
    expect(api.fetchQueue).toHaveBeenCalledTimes(1);
  });

  it("with pending reviews, the pending count is shown", async () => {
    render(<FacultyDashboard />);
    const summary = await screen.findByRole("region", { name: "Summary" });
    expect(summary).toHaveTextContent("Pending reviews1waiting for your decision");
  });

  it("with no pending reviews, it says everything is reviewed and the queue is empty", async () => {
    api.fetchQueue.mockResolvedValue([item({ status: "approved", officialScore: 88 })]);
    render(<FacultyDashboard />);
    const summary = await screen.findByRole("region", { name: "Summary" });
    expect(summary).toHaveTextContent("all caught up");
    expect(screen.getByText("Nothing is waiting for review.")).toBeInTheDocument();
  });

  it("shows an error with retry, and recovers", async () => {
    api.fetchQueue.mockRejectedValueOnce(new Error("Storage is not configured on the server."));
    const user = userEvent.setup();
    render(<FacultyDashboard />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Storage is not configured");
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("region", { name: "Summary" })).toBeInTheDocument();
  });

  it("shows empty states, not invented numbers, when there is no data at all", async () => {
    api.fetchQueue.mockResolvedValue([]);
    api.fetchProjects.mockResolvedValue([]);
    render(<FacultyDashboard />);
    await screen.findByRole("region", { name: "Summary" });
    expect(screen.getByText(/Charts appear here once/)).toBeInTheDocument();
    expect(screen.getByText("No projects have been created yet.")).toBeInTheDocument();
    expect(screen.getByText("Nothing is waiting for review.")).toBeInTheDocument();
  });
});
