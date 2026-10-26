import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { QueueItem } from "@/lib/schemas/review";

const api = vi.hoisted(() => ({ fetchQueue: vi.fn() }));
vi.mock("@/lib/api/client", () => api);

import { FacultyQueue } from "./FacultyQueue";

const item = (over: Partial<QueueItem> = {}): QueueItem => ({
  evaluationId: "00000000-0000-4000-9000-000000000001",
  projectId: "123e4567-e89b-42d3-a456-426614174000",
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
  api.fetchQueue.mockResolvedValue([item()]);
});

describe("FacultyQueue", () => {
  it("shows pending evaluations, labelling the AI score as not official, with a link to review", async () => {
    render(<FacultyQueue />);
    expect(screen.getByText("Loading evaluations…")).toBeInTheDocument();
    expect(await screen.findByText("Library app · Week 2")).toBeInTheDocument();
    expect(screen.getByText(/AI suggestion \(not official\): 71.5\/100/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Review/ })).toHaveAttribute(
      "href",
      "/faculty/evaluations/00000000-0000-4000-9000-000000000001",
    );
    expect(api.fetchQueue).toHaveBeenCalledWith("pending_review");
  });

  it("changes the filter and loads that list", async () => {
    api.fetchQueue.mockImplementation(async (status: string) =>
      status === "approved" ? [item({ status: "approved", projectTitle: "Done project" })] : [item()],
    );
    const user = userEvent.setup();
    render(<FacultyQueue />);
    await screen.findByText("Library app · Week 2");
    await user.click(screen.getByRole("button", { name: "Approved" }));
    expect(await screen.findByText("Done project · Week 2")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /View/ })).toBeInTheDocument();
    expect(api.fetchQueue).toHaveBeenLastCalledWith("approved");
    expect(screen.getByRole("button", { name: "Approved" })).toHaveAttribute("aria-pressed", "true");
  });

  it("shows each student's quiz result next to the row, apart from the AI's score", async () => {
    api.fetchQueue.mockResolvedValue([
      item({ evaluationId: "00000000-0000-4000-9000-000000000001", projectTitle: "Taken project", quiz: { status: "taken", correctCount: 1, total: 5 } }),
      item({ evaluationId: "00000000-0000-4000-9000-000000000002", projectTitle: "Open project", quiz: { status: "not_taken", correctCount: null, total: null } }),
      item({ evaluationId: "00000000-0000-4000-9000-000000000003", projectTitle: "No quiz project" }),
    ]);
    render(<FacultyQueue />);
    await screen.findByText("Taken project · Week 2");
    const rows = screen.getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent("Student quiz: 1/5 correct");
    expect(rows[1]).toHaveTextContent("Student quiz: created, not taken yet");
    expect(rows[2]).toHaveTextContent("Student quiz: not started");
    // The AI's number is still labelled as not official, and the quiz is not folded into it.
    expect(rows[0]).toHaveTextContent("AI suggestion (not official): 71.5/100");
    expect(rows[0]).not.toHaveTextContent("Official score");
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
    expect(await screen.findByText("Library app · Week 2")).toBeInTheDocument();
  });
});

describe("FacultyQueue: official versus AI score", () => {
  it("shows the official score next to the AI's for decided rows, so an edit is not mistaken for the AI's number", async () => {
    api.fetchQueue.mockResolvedValue([
      item({ status: "edited", suggestedScore: 15, officialScore: 40 }),
      item({ evaluationId: "00000000-0000-4000-9000-000000000002", status: "rejected", officialScore: null, weekNumber: 3 }),
      item({ evaluationId: "00000000-0000-4000-9000-000000000003", status: "pending_review", weekNumber: 4 }),
    ]);
    render(<FacultyQueue />);
    expect(await screen.findByText("Official score: 40/100")).toBeInTheDocument();
    expect(screen.getByText(/AI suggestion \(not official\): 15\/100/)).toBeInTheDocument();
    expect(screen.getByText("No official score")).toBeInTheDocument();
    expect(screen.getAllByText(/Official score|No official score/)).toHaveLength(2); // none for the pending row
  });
});
