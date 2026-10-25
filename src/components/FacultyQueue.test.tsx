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
  confidence: "medium",
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
