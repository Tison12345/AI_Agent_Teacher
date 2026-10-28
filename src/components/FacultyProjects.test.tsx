import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { Project } from "@/lib/schemas/project";
import type { QueueItem } from "@/lib/schemas/review";
import { FacultyProjects } from "./FacultyProjects";

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
  repoUrl: "https://github.com/octocat/library",
  durationWeeks: 4,
  createdAt: "2026-10-25T12:00:00+00:00",
});
const card = (title: string) => screen.getByRole("heading", { name: new RegExp(title) }).closest("article") as HTMLElement;

describe("FacultyProjects", () => {
  it("with no projects it says so", () => {
    render(<FacultyProjects items={[]} projects={[]} />);
    expect(screen.getByText("No projects have been created yet.")).toBeInTheDocument();
  });

  it("each project shows its average official score, reviewed and pending weeks, and links to its page", () => {
    render(
      <FacultyProjects
        projects={[project(P1, "Library app"), project(P2, "Quiet app")]}
        items={[
          item({ weekNumber: 1, status: "approved", suggestedScore: 100, officialScore: 80 }),
          item({ weekNumber: 2, status: "edited", suggestedScore: 100, officialScore: 60 }),
          item({ weekNumber: 3, status: "pending_review", suggestedScore: 100 }),
        ]}
      />,
    );
    const a = card("Library app");
    expect(within(a).getByText("Avg score").nextElementSibling).toHaveTextContent("70");
    expect(within(a).getByText("Reviewed").nextElementSibling).toHaveTextContent("2/3");
    expect(within(a).getByText("Pending").nextElementSibling).toHaveTextContent("1");
    expect(a).toHaveTextContent("3 evaluated weeks");
    expect(a).toHaveTextContent("octocat/library");
    expect(within(a).getByRole("link", { name: /Library app/ })).toHaveAttribute("href", `/faculty/projects/${P1}`);
  });

  it("a project without evaluations shows a dash, not a score, and says so", () => {
    render(<FacultyProjects projects={[project(P2, "Quiet app")]} items={[]} />);
    const b = card("Quiet app");
    expect(within(b).getByText("Avg score").nextElementSibling).toHaveTextContent("–");
    expect(within(b).getByText("Pending").nextElementSibling).toHaveTextContent("0");
    expect(b).toHaveTextContent("No evaluated weeks yet");
  });

  it("only counts the evaluations of its own project", () => {
    render(
      <FacultyProjects
        projects={[project(P1, "Library app"), project(P2, "Quiet app")]}
        items={[item({ projectId: P1, status: "approved", officialScore: 90 })]}
      />,
    );
    expect(within(card("Quiet app")).getByText("Reviewed").nextElementSibling).toHaveTextContent("0/0");
  });
});
