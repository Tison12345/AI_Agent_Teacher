import { beforeEach, describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { QueueItem } from "@/lib/schemas/review";
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
  n = 0;
});

/** The project's dropdown (a <details> element) found by its title. */
const project = (title: string) => screen.getByText(title).closest("details") as HTMLElement;

describe("FacultyQueue", () => {
  it("shows one dropdown per project, closed to begin with, with the number of weeks", () => {
    render(
      <FacultyQueue
        items={[
          item({ weekNumber: 1 }),
          item({ weekNumber: 2 }),
          item({ weekNumber: 3 }),
          item({ projectId: PROJECT_B, projectTitle: "Other app", weekNumber: 1 }),
        ]}
      />,
    );
    expect(document.querySelectorAll("details")).toHaveLength(2);
    expect([...document.querySelectorAll("summary")].map((s) => s.textContent)).toEqual([
      expect.stringContaining("Library app"),
      expect.stringContaining("Other app"),
    ]);
    expect(project("Library app")).not.toHaveAttribute("open");
    expect(within(project("Library app")).getByText("3 weeks")).toBeInTheDocument();
    expect(within(project("Other app")).getByText("1 week")).toBeInTheDocument();
  });

  it("opens to a card for each week, in week order, with only the score, a quiz tag and a status", async () => {
    const user = userEvent.setup();
    render(
      <FacultyQueue
        items={[
          item({ weekNumber: 3, suggestedScore: 90 }),
          item({ weekNumber: 1, status: "approved", suggestedScore: 100, officialScore: 80, quiz: { status: "taken", correctCount: 1, total: 5 } }),
        ]}
      />,
    );
    // The default filter is "Waiting for review", so look at everything.
    await user.click(screen.getByRole("button", { name: /^All/ }));
    await user.click(screen.getByText("Library app"));
    const cards = within(project("Library app")).getAllByRole("listitem");
    expect(cards.map((c) => c.querySelector("p")?.textContent)).toEqual(["Week 1", "Week 3"]);

    expect(cards[0]).toHaveTextContent("Score 80/100"); // the official score, not the AI's 100
    expect(cards[0]).not.toHaveTextContent("AI suggestion");
    expect(cards[0]).not.toHaveTextContent("100/100");
    expect(cards[0]).toHaveTextContent("Quiz 1/5");
    expect(cards[0]).toHaveTextContent("Approved");
    expect(cards[1]).toHaveTextContent("AI suggestion 90/100 (not official)");
    expect(cards[1]).toHaveTextContent("Quiz not started");
    expect(cards[1]).toHaveTextContent("Waiting for review");
    expect(cards[1]).not.toHaveTextContent(/confidence|created|\d{4}/i);
  });

  it("shows a quiz that exists but was not taken, and a rejection without a score", async () => {
    const user = userEvent.setup();
    render(
      <FacultyQueue
        items={[
          item({ weekNumber: 1, quiz: { status: "not_taken", correctCount: null, total: null } }),
          item({ weekNumber: 2, status: "rejected", officialScore: null }),
        ]}
      />,
    );
    await user.click(screen.getByRole("button", { name: /^All/ }));
    await user.click(screen.getByText("Library app"));
    const cards = within(project("Library app")).getAllByRole("listitem");
    expect(cards[0]).toHaveTextContent("Quiz not taken");
    expect(cards[1]).toHaveTextContent("No official score");
  });

  it("each week links to its review, and the arrow at the bottom links to the project overview", async () => {
    const week = item({ weekNumber: 2 });
    const user = userEvent.setup();
    render(<FacultyQueue items={[week]} />);
    await user.click(screen.getByText("Library app"));
    expect(screen.getByRole("link", { name: /Review/ })).toHaveAttribute("href", `/faculty/evaluations/${week.evaluationId}`);
    const arrow = screen.getByRole("link", { name: "Open the overview of Library app" });
    expect(arrow).toHaveAttribute("href", `/faculty/projects/${PROJECT_A}`);
    expect(arrow.querySelector("svg")).not.toBeNull();
  });

  it("decided weeks say View instead of Review", async () => {
    const user = userEvent.setup();
    render(<FacultyQueue items={[item({ status: "edited", officialScore: 65 })]} />);
    await user.click(screen.getByRole("button", { name: /^Edited/ }));
    await user.click(screen.getByText("Library app"));
    expect(screen.getByRole("link", { name: /View/ })).toBeInTheDocument();
  });
});

describe("FacultyQueue: filters", () => {
  const items = () => [
    item({ projectTitle: "Waiting project" }),
    item({ projectId: PROJECT_B, projectTitle: "Done project", status: "approved", officialScore: 50 }),
    item({ projectId: "323e4567-e89b-42d3-a456-426614174000", projectTitle: "Edited project", status: "edited", officialScore: 40 }),
  ];

  it("starts on 'Waiting for review' and shows only those", () => {
    render(<FacultyQueue items={items()} />);
    expect(screen.getByRole("button", { name: /^Waiting for review/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Waiting project")).toBeInTheDocument();
    expect(screen.queryByText("Done project")).not.toBeInTheDocument();
  });

  it("changes the filter, shows only that status and marks the active filter", async () => {
    const user = userEvent.setup();
    render(<FacultyQueue items={items()} />);
    await user.click(screen.getByRole("button", { name: /^Approved/ }));
    expect(screen.getByText("Done project")).toBeInTheDocument();
    expect(screen.queryByText("Waiting project")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Approved/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /^Waiting for review/ })).toHaveAttribute("aria-pressed", "false");
    await user.click(screen.getByRole("button", { name: /^All/ }));
    expect(screen.getAllByRole("listitem").length).toBeGreaterThan(0);
    expect(screen.getByText("Edited project")).toBeInTheDocument();
  });

  it("each filter shows how many evaluations it holds", () => {
    render(<FacultyQueue items={items()} />);
    const count = (name: RegExp) => screen.getByRole("button", { name }).querySelector("span")?.textContent;
    expect(count(/^Waiting for review/)).toBe("1");
    expect(count(/^Approved/)).toBe("1");
    expect(count(/^Edited/)).toBe("1");
    expect(count(/^Rejected/)).toBe("0");
    expect(count(/^All/)).toBe("3");
  });

  it("says when nothing is waiting, or nothing matches", async () => {
    const user = userEvent.setup();
    render(<FacultyQueue items={[item({ status: "approved", officialScore: 50 })]} />);
    expect(screen.getByText("Nothing is waiting for review.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^Rejected/ }));
    expect(screen.getByText("No evaluations match this filter.")).toBeInTheDocument();
  });
});
