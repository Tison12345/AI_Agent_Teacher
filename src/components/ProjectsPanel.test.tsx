import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Progress } from "@/lib/schemas/checkpoint";
import type { Project } from "@/lib/schemas/project";

const api = vi.hoisted(() => ({
  fetchProjects: vi.fn(),
  createProject: vi.fn(),
  fetchResults: vi.fn(),
  fetchProgress: vi.fn(),
}));
vi.mock("@/lib/api/client", () => api);

import { ProjectsPanel } from "./ProjectsPanel";

const project: Project = {
  id: "123e4567-e89b-42d3-a456-426614174000",
  title: "Smart Attendance",
  description: "A system that marks attendance using faces.",
  repoUrl: "https://github.com/octocat/hello-world",
  durationWeeks: 12,
  createdAt: "2026-10-25T12:00:00+00:00",
};
const other: Project = {
  ...project,
  id: "223e4567-e89b-42d3-a456-426614174000",
  title: "Reading List",
  durationWeeks: 1,
  repoUrl: "https://github.com/octocat/reading",
};

const sha = "a".repeat(40);
const checkpoint = (weekNumber: number) => ({ weekNumber, commitSha: sha, baseCommitSha: sha }) as never;
const progressOf = (over: Partial<Progress> = {}): Progress => ({ baseline: null, checkpoints: [], evaluations: [], ...over });
const result = (weekNumber: number, officialScore: number | null, outcome = "approved") => ({
  weekNumber,
  outcome,
  officialScore,
  feedback: null,
  decidedAt: "2026-10-26T12:00:00+00:00",
});

beforeEach(() => {
  vi.clearAllMocks();
  api.fetchResults.mockResolvedValue([]);
  api.fetchProgress.mockResolvedValue(progressOf());
});

const card = async (title: string) =>
  (await screen.findByRole("heading", { name: new RegExp(title) })).closest("article") as HTMLElement;
const stat = (label: string) => screen.getByText(label).closest("div")!.parentElement as HTMLElement;

describe("ProjectsPanel: empty and loading", () => {
  it("shows a loading state, then the empty state with the create form open and zeroed totals", async () => {
    api.fetchProjects.mockResolvedValue([]);
    render(<ProjectsPanel />);
    expect(screen.getByText("Loading projects…")).toBeInTheDocument();
    expect(await screen.findByText(/No projects yet/)).toBeInTheDocument();
    expect(stat("Total projects")).toHaveTextContent("0");
    expect(stat("Average official score")).toHaveTextContent("–");
    expect(stat("Average official score")).toHaveTextContent("No approved weeks yet");
    expect(stat("Weeks recorded")).toHaveTextContent("No weeks planned yet");
    expect(screen.getByLabelText("Project title")).toBeVisible();
    expect(api.fetchProgress).not.toHaveBeenCalled();
  });

  it("shows an error with retry, and recovers", async () => {
    api.fetchProjects
      .mockRejectedValueOnce(new Error("Storage is not configured on the server."))
      .mockResolvedValueOnce([project]);
    const user = userEvent.setup();
    render(<ProjectsPanel />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Storage is not configured on the server.");
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("link", { name: /Smart Attendance/ })).toBeInTheDocument();
  });
});

describe("ProjectsPanel: the overview cards", () => {
  it("computes every total from the real progress of every project", async () => {
    api.fetchProjects.mockResolvedValue([project, other]);
    api.fetchProgress.mockImplementation(async (id: string) =>
      id === project.id
        ? progressOf({
            checkpoints: [checkpoint(1), checkpoint(2), checkpoint(3)],
            evaluations: [
              { weekNumber: 1, status: "approved" },
              { weekNumber: 2, status: "edited" },
              { weekNumber: 3, status: "pending_review" },
            ],
          })
        : progressOf({ checkpoints: [checkpoint(1)], evaluations: [{ weekNumber: 1, status: "approved" }] }),
    );
    api.fetchResults.mockImplementation(async (id: string) =>
      id === project.id ? [result(1, 80), result(2, 60, "edited")] : [result(1, 100)],
    );
    render(<ProjectsPanel />);
    await within((await card("Reading List"))).findByText("100");
    expect(stat("Total projects")).toHaveTextContent("2");
    expect(stat("Average official score")).toHaveTextContent("80"); // (80 + 60 + 100) / 3
    expect(stat("Average official score")).toHaveTextContent("across 3 teacher-approved weeks");
    expect(stat("Weeks recorded")).toHaveTextContent("4");
    expect(stat("Weeks recorded")).toHaveTextContent("of 13 planned");
    expect(stat("Awaiting review")).toHaveTextContent("1");
    expect(stat("Approved weeks")).toHaveTextContent("3");
  });

  it("with projects but nothing recorded yet, no score is invented", async () => {
    api.fetchProjects.mockResolvedValue([project]);
    render(<ProjectsPanel />);
    await within((await card("Smart Attendance"))).findByText("Not graded yet");
    expect(stat("Average official score")).toHaveTextContent("–");
    expect(stat("Weeks recorded")).toHaveTextContent("0");
    expect(api.fetchResults).not.toHaveBeenCalled(); // no decided week, so nothing to ask for
  });

  it("says when one project's progress could not be loaded, and leaves it out of the totals", async () => {
    api.fetchProjects.mockResolvedValue([project, other]);
    api.fetchProgress.mockImplementation(async (id: string) => {
      if (id === project.id) throw new Error("down");
      return progressOf({ checkpoints: [checkpoint(1)], evaluations: [{ weekNumber: 1, status: "pending_review" }] });
    });
    render(<ProjectsPanel />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Progress could not be loaded for 1 project");
    expect(within((await card("Smart Attendance"))).getByText(/could not be loaded/)).toBeInTheDocument();
    expect(stat("Weeks recorded")).toHaveTextContent("1");
    expect(stat("Total projects")).toHaveTextContent("2");
  });

  it("does not call a project graded when the official results could not be fetched", async () => {
    api.fetchProjects.mockResolvedValue([project]);
    api.fetchProgress.mockResolvedValue(progressOf({ checkpoints: [checkpoint(1)], evaluations: [{ weekNumber: 1, status: "approved" }] }));
    api.fetchResults.mockRejectedValue(new Error("down"));
    render(<ProjectsPanel />);
    expect(await within((await card("Smart Attendance"))).findByText(/could not be loaded/)).toBeInTheDocument();
    expect(within((await card("Smart Attendance"))).queryByText("Not graded yet")).not.toBeInTheDocument();
  });
});

describe("ProjectsPanel: project cards", () => {
  it("each card shows the repository, score, weeks recorded, a progress bar and the week counts", async () => {
    api.fetchProjects.mockResolvedValue([project]);
    api.fetchProgress.mockResolvedValue(
      progressOf({
        checkpoints: [checkpoint(1), checkpoint(2), checkpoint(3)],
        evaluations: [
          { weekNumber: 1, status: "approved" },
          { weekNumber: 2, status: "pending_review" },
        ],
      }),
    );
    api.fetchResults.mockResolvedValue([result(1, 90)]);
    render(<ProjectsPanel />);
    const c = (await card("Smart Attendance"));
    expect(await within(c).findByLabelText("Smart Attendance overall official score 90 out of 100")).toBeInTheDocument();
    expect(c).toHaveTextContent("octocat/hello-world");
    expect(c).toHaveTextContent("12 weeks");
    expect(c).toHaveTextContent("3 of 12 weeks recorded");
    expect(within(c).getByRole("progressbar", { name: "Smart Attendance: weeks recorded" })).toHaveAttribute("aria-valuenow", "25");
    expect(c).toHaveTextContent("1 approved");
    expect(c).toHaveTextContent("1 pending review");
    expect(c).toHaveTextContent("9 not recorded");
    expect(within(c).getByRole("link", { name: /Smart Attendance/ })).toHaveAttribute("href", `/student/projects/${project.id}`);
  });

  it("a score of zero is shown as 0, not as 'Not graded yet'", async () => {
    api.fetchProjects.mockResolvedValue([other]);
    api.fetchProgress.mockResolvedValue(progressOf({ checkpoints: [checkpoint(1)], evaluations: [{ weekNumber: 1, status: "approved" }] }));
    api.fetchResults.mockResolvedValue([result(1, 0)]);
    render(<ProjectsPanel />);
    expect(await within((await card("Reading List"))).findByLabelText(/overall official score 0 out of 100/)).toBeInTheDocument();
    expect(within((await card("Reading List"))).queryByText("Not graded yet")).not.toBeInTheDocument();
  });
});

describe("ProjectsPanel: creating a project", () => {
  it("keeps the form out of the way when there are projects, and opens and closes it from a button", async () => {
    api.fetchProjects.mockResolvedValue([project]);
    const user = userEvent.setup();
    render(<ProjectsPanel />);
    await screen.findByRole("link", { name: /Smart Attendance/ });
    const toggle = screen.getByRole("button", { name: "Create project" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByLabelText("Project title")).not.toBeVisible();
    await user.click(toggle);
    expect(screen.getByRole("button", { name: "Close" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByLabelText("Project title")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.getByLabelText("Project title")).not.toBeVisible();
  });

  it("adds a newly created project to the list", async () => {
    api.fetchProjects.mockResolvedValue([]);
    api.createProject.mockResolvedValue({ result: { ok: true }, project });
    const user = userEvent.setup();
    render(<ProjectsPanel />);
    await screen.findByText(/No projects yet/);
    await user.type(screen.getByLabelText("Project title"), project.title);
    await user.type(screen.getByLabelText("Short project description"), project.description);
    await user.type(screen.getByLabelText("GitHub repository URL"), project.repoUrl);
    await user.click(screen.getByRole("button", { name: "Create project" }));
    expect(await screen.findByRole("link", { name: /Smart Attendance/ })).toBeInTheDocument();
    expect(api.createProject).toHaveBeenCalledTimes(1);
    expect(stat("Total projects")).toHaveTextContent("1");
  });
});
