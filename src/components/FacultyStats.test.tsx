import { beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { Project } from "@/lib/schemas/project";
import type { QueueItem } from "@/lib/schemas/review";
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
const project = (id: string, title: string): Project => ({
  id,
  title,
  description: "A description that is long enough.",
  repoUrl: "https://github.com/o/r",
  durationWeeks: 4,
  createdAt: "2026-10-25T12:00:00+00:00",
});
const PROJECTS = [project(P1, "Library app"), project(P2, "Other app")];

beforeEach(() => {
  n = 0;
});

/** The card whose label is `label`. */
const stat = (label: string) => screen.getByText(label).closest("div")!.parentElement as HTMLElement;

describe("FacultyStats", () => {
  it("with nothing yet: no average is invented and nothing is pending", () => {
    render(<FacultyStats items={[]} projects={[]} />);
    expect(stat("Total projects")).toHaveTextContent("0");
    expect(stat("Projects with evaluations")).toHaveTextContent("no projects yet");
    expect(stat("Average official score")).toHaveTextContent("–");
    expect(stat("Average official score")).toHaveTextContent("no scored weeks yet");
    expect(stat("Pending reviews")).toHaveTextContent("0");
    expect(stat("Pending reviews")).toHaveTextContent("all caught up");
    expect(stat("Quiz average")).toHaveTextContent("–");
  });

  it("averages only official scores: the AI's suggestion and rejected weeks never count", () => {
    render(
      <FacultyStats
        items={[
          item({ weekNumber: 1, status: "approved", suggestedScore: 100, officialScore: 80 }),
          item({ weekNumber: 2, status: "edited", suggestedScore: 100, officialScore: 60 }),
          item({ weekNumber: 3, status: "rejected", suggestedScore: 100, officialScore: null }),
          item({ weekNumber: 4, status: "pending_review", suggestedScore: 100 }),
        ]}
        projects={PROJECTS}
      />,
    );
    expect(stat("Average official score")).toHaveTextContent("70");
    expect(stat("Average official score")).toHaveTextContent("across 2 scored weeks");
  });

  it("a real average of zero is shown as 0, not as missing", () => {
    render(<FacultyStats items={[item({ status: "approved", officialScore: 0 })]} projects={PROJECTS} />);
    expect(stat("Average official score")).toHaveTextContent("0");
    expect(stat("Average official score")).not.toHaveTextContent("–");
  });

  it("counts projects, evaluated projects, pending and reviewed weeks and quizzes from the real data", () => {
    render(
      <FacultyStats
        items={[
          item({ weekNumber: 1, status: "pending_review", quiz: { status: "taken", correctCount: 1, total: 5 } }),
          item({ weekNumber: 2, status: "pending_review", quiz: { status: "not_taken", correctCount: null, total: null } }),
          item({ projectId: P2, projectTitle: "Other app", weekNumber: 1, status: "approved", officialScore: 50, quiz: { status: "taken", correctCount: 3, total: 5 } }),
        ]}
        projects={PROJECTS}
      />,
    );
    expect(stat("Total projects")).toHaveTextContent("2");
    expect(stat("Projects with evaluations")).toHaveTextContent("2");
    expect(stat("Projects with evaluations")).toHaveTextContent("of 2");
    expect(stat("Pending reviews")).toHaveTextContent("2");
    expect(stat("Pending reviews")).toHaveTextContent("waiting for your decision");
    expect(stat("Reviewed weeks")).toHaveTextContent("1");
    expect(stat("Quiz average")).toHaveTextContent("40%"); // (20% + 60%) / 2
    expect(stat("Quiz average")).toHaveTextContent("2 quizzes taken");
  });

  it("a project with no evaluation is a project but not an evaluated project", () => {
    render(<FacultyStats items={[item()]} projects={PROJECTS} />);
    expect(stat("Total projects")).toHaveTextContent("2");
    expect(stat("Projects with evaluations")).toHaveTextContent("1");
  });

  it("shows a dash for the quiz average when nobody has taken a quiz", () => {
    render(<FacultyStats items={[item()]} projects={PROJECTS} />);
    expect(stat("Quiz average")).toHaveTextContent("–");
    expect(stat("Quiz average")).toHaveTextContent("no quizzes taken yet");
  });
});
