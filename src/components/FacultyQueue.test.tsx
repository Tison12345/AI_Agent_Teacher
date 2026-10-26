import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { QueueItem } from "@/lib/schemas/review";

const api = vi.hoisted(() => ({ fetchQueue: vi.fn() }));
vi.mock("@/lib/api/client", () => api);

import { FacultyQueue } from "./FacultyQueue";

const PROJECT_A = "123e4567-e89b-42d3-a456-426614174000";
const PROJECT_B = "223e4567-e89b-42d3-a456-426614174000";
let n = 0;

const item = (over: Partial<QueueItem> = {}): QueueItem => ({
  evaluationId: `00000000-0000-4000-9000-${String(++n).padStart(12, "0")}`,
  projectId: PROJECT_A,
  projectTitle: "Library app",
  weekNumber: 2,
  status: "pending_review",
  suggestedScore: 71.5,
  officialScore: null,
  confidence: "medium",
  quiz: { status: "not_created", correctCount: null, total: null },
  createdAt: "2026-10-26T10:00:00+00:00",
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  n = 0;
  api.fetchQueue.mockResolvedValue([item()]);
});

/** The project's dropdown (a <details> element) found by its title. */
const project = (title: string) => screen.getByText(title).closest("details") as HTMLElement;

describe("FacultyQueue", () => {
  it("shows one dropdown per project, closed to begin with, with the number of weeks", async () => {
    api.fetchQueue.mockResolvedValue([
      item({ weekNumber: 1 }),
      item({ weekNumber: 2 }),
      item({ weekNumber: 3 }),
      item({ projectId: PROJECT_B, projectTitle: "Other app", weekNumber: 1 }),
    ]);
    render(<FacultyQueue />);
    expect(screen.getByText("Loading evaluations…")).toBeInTheDocument();
    await screen.findByText("Library app");
    // One dropdown per project, not one card per week.
    expect(document.querySelectorAll("details")).toHaveLength(2);
    expect([...document.querySelectorAll("summary")].map((s) => s.textContent)).toEqual([
      expect.stringContaining("Library app"),
      expect.stringContaining("Other app"),
    ]);
    expect(project("Library app")).not.toHaveAttribute("open");
    expect(within(project("Library app")).getByText("3 weeks")).toBeInTheDocument();
    expect(within(project("Other app")).getByText("1 week")).toBeInTheDocument();
    expect(api.fetchQueue).toHaveBeenCalledWith("pending_review");
  });

  it("opens to a card for each week, in week order, with only the score, a quiz tag and a status", async () => {
    api.fetchQueue.mockResolvedValue([
      item({ weekNumber: 3, suggestedScore: 90 }),
      item({ weekNumber: 1, status: "approved", suggestedScore: 100, officialScore: 80, quiz: { status: "taken", correctCount: 1, total: 5 } }),
    ]);
    const user = userEvent.setup();
    render(<FacultyQueue />);
    await user.click(await screen.findByText("Library app"));
    const cards = within(project("Library app")).getAllByRole("listitem");
    expect(cards.map((c) => c.querySelector("p")?.textContent)).toEqual(["Week 1", "Week 3"]);

    expect(cards[0]).toHaveTextContent("Score 80/100"); // the official score, not the AI's 100
    expect(cards[0]).not.toHaveTextContent("AI suggestion"); // the AI's own 100 is not on a decided card
    expect(cards[0]).not.toHaveTextContent("100/100");
    expect(cards[0]).toHaveTextContent("Quiz 1/5");
    expect(cards[0]).toHaveTextContent("Approved");
    expect(cards[1]).toHaveTextContent("AI suggestion 90/100 (not official)");
    expect(cards[1]).toHaveTextContent("Quiz not started");
    expect(cards[1]).toHaveTextContent("Waiting for review");
    // Nothing else: no confidence, dates or other detail on the cards.
    expect(cards[1]).not.toHaveTextContent(/confidence|created|\d{4}/i);
  });

  it("shows a quiz that exists but was not taken, and a rejection without a score", async () => {
    api.fetchQueue.mockResolvedValue([
      item({ weekNumber: 1, quiz: { status: "not_taken", correctCount: null, total: null } }),
      item({ weekNumber: 2, status: "rejected", officialScore: null }),
    ]);
    const user = userEvent.setup();
    render(<FacultyQueue />);
    await user.click(await screen.findByText("Library app"));
    const cards = within(project("Library app")).getAllByRole("listitem");
    expect(cards[0]).toHaveTextContent("Quiz not taken");
    expect(cards[1]).toHaveTextContent("No official score");
  });

  it("each week links to its review, and the arrow at the bottom links to the project overview", async () => {
    const week = item({ weekNumber: 2 });
    api.fetchQueue.mockResolvedValue([week]);
    const user = userEvent.setup();
    render(<FacultyQueue />);
    await user.click(await screen.findByText("Library app"));
    expect(screen.getByRole("link", { name: /Review/ })).toHaveAttribute("href", `/faculty/evaluations/${week.evaluationId}`);
    const arrow = screen.getByRole("link", { name: "Open the overview of Library app" });
    expect(arrow).toHaveAttribute("href", `/faculty/projects/${PROJECT_A}`);
    expect(arrow.querySelector("svg")).not.toBeNull(); // the arrow icon; the link's name comes from the hidden text
  });

  it("decided weeks say View instead of Review", async () => {
    api.fetchQueue.mockResolvedValue([item({ status: "edited", officialScore: 65 })]);
    const user = userEvent.setup();
    render(<FacultyQueue />);
    await user.click(await screen.findByText("Library app"));
    expect(screen.getByRole("link", { name: /View/ })).toBeInTheDocument();
  });

  it("changes the filter and loads that list", async () => {
    api.fetchQueue.mockImplementation(async (status: string) =>
      status === "approved" ? [item({ status: "approved", projectTitle: "Done project", officialScore: 50 })] : [item()],
    );
    const user = userEvent.setup();
    render(<FacultyQueue />);
    await screen.findByText("Library app");
    await user.click(screen.getByRole("button", { name: "Approved" }));
    expect(await screen.findByText("Done project")).toBeInTheDocument();
    expect(api.fetchQueue).toHaveBeenLastCalledWith("approved");
    expect(screen.getByRole("button", { name: "Approved" })).toHaveAttribute("aria-pressed", "true");
  });

  it("says when nothing is waiting", async () => {
    api.fetchQueue.mockResolvedValue([]);
    render(<FacultyQueue />);
    expect(await screen.findByText("Nothing is waiting for review.")).toBeInTheDocument();
  });

  it("shows an error and retries", async () => {
    api.fetchQueue.mockRejectedValueOnce(new Error("Storage is not configured on the server."));
    const user = userEvent.setup();
    render(<FacultyQueue />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Storage is not configured");
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Library app")).toBeInTheDocument();
  });
});
