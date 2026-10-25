import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Project } from "@/lib/schemas/project";

const api = vi.hoisted(() => ({
  fetchProjects: vi.fn(),
  createProject: vi.fn(),
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

beforeEach(() => vi.clearAllMocks());

describe("ProjectsPanel", () => {
  it("shows a loading state, then the empty state", async () => {
    api.fetchProjects.mockResolvedValue([]);
    render(<ProjectsPanel />);
    expect(screen.getByText("Loading projects…")).toBeInTheDocument();
    expect(await screen.findByText(/No projects yet/)).toBeInTheDocument();
  });

  it("lists projects with links to their detail page", async () => {
    api.fetchProjects.mockResolvedValue([project]);
    render(<ProjectsPanel />);
    const link = await screen.findByRole("link", { name: "Smart Attendance" });
    expect(link).toHaveAttribute("href", `/student/projects/${project.id}`);
  });

  it("shows an error with retry, and recovers", async () => {
    api.fetchProjects
      .mockRejectedValueOnce(new Error("Storage is not configured on the server."))
      .mockResolvedValueOnce([project]);
    const user = userEvent.setup();
    render(<ProjectsPanel />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Storage is not configured on the server.",
    );
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(
      await screen.findByRole("link", { name: "Smart Attendance" }),
    ).toBeInTheDocument();
  });

  it("adds a newly created project to the list", async () => {
    api.fetchProjects.mockResolvedValue([]);
    api.createProject.mockResolvedValue({ result: { ok: true }, project });
    const user = userEvent.setup();
    render(<ProjectsPanel />);
    await screen.findByText(/No projects yet/);
    await user.type(screen.getByLabelText("Project title"), project.title);
    await user.type(
      screen.getByLabelText("Short project description"),
      project.description,
    );
    await user.type(
      screen.getByLabelText("GitHub repository URL"),
      project.repoUrl,
    );
    await user.click(screen.getByRole("button", { name: "Create project" }));
    expect(
      await screen.findByRole("link", { name: "Smart Attendance" }),
    ).toBeInTheDocument();
    expect(api.createProject).toHaveBeenCalledTimes(1);
  });
});
