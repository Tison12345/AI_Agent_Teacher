import { beforeEach, describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { QueueItem } from "@/lib/schemas/review";
import { FacultyAnalytics } from "./FacultyAnalytics";

let n = 0;
const item = (over: Partial<QueueItem> = {}): QueueItem => ({
  evaluationId: `00000000-0000-4000-9000-${String(++n).padStart(12, "0")}`,
  projectId: "123e4567-e89b-42d3-a456-426614174000",
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
  n = 0;
});

describe("FacultyAnalytics", () => {
  it("with no evaluations it shows an empty state and no chart", () => {
    render(<FacultyAnalytics items={[]} />);
    expect(screen.getByText(/Charts appear here once/)).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Official result by week" })).not.toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("charts the average official score of each week across projects, never the AI's", () => {
    render(
      <FacultyAnalytics
        items={[
          item({ projectId: "a", weekNumber: 1, status: "approved", suggestedScore: 100, officialScore: 80 }),
          item({ projectId: "b", weekNumber: 1, status: "edited", suggestedScore: 100, officialScore: 60 }),
          item({ projectId: "a", weekNumber: 2, status: "pending_review", suggestedScore: 100 }),
        ]}
      />,
    );
    const bars = screen.getByRole("group", { name: "Official result by week" });
    expect(bars).toHaveTextContent("W1: 70 out of 100");
    expect(bars).toHaveTextContent("W2 has no official result (Awaiting review)");
  });

  it("a week with only a rejection has no bar, and is not shown as zero", () => {
    render(<FacultyAnalytics items={[item({ weekNumber: 1, status: "rejected", officialScore: null })]} />);
    const bars = screen.getByRole("group", { name: "Official result by week" });
    expect(bars).toHaveTextContent("W1 has no official result (No scores)");
    expect(bars).not.toHaveTextContent("0 out of 100");
  });

  it("shows how many evaluations are in each status, with percentages, as text as well as colour", () => {
    render(
      <FacultyAnalytics
        items={[
          item({ status: "pending_review" }),
          item({ status: "approved", officialScore: 90 }),
          item({ status: "approved", officialScore: 70 }),
          item({ status: "rejected" }),
        ]}
      />,
    );
    expect(screen.getByRole("img")).toHaveAccessibleName("Waiting for review: 1, Approved: 2, Edited: 0, Rejected: 1");
    const row = (label: string) => screen.getByText(label).closest("div") as HTMLElement;
    expect(row("Approved")).toHaveTextContent("250%");
    expect(row("Waiting for review")).toHaveTextContent("125%");
    expect(row("Edited")).toHaveTextContent("00%");
    expect(within(row("Rejected")).getByText("25%")).toBeInTheDocument();
    expect(screen.getByText("4 evaluations in total.")).toBeInTheDocument();
  });
});
