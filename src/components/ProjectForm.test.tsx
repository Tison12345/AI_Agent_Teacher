import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProjectForm, type ProjectSubmitResult } from "./ProjectForm";

type User = ReturnType<typeof userEvent.setup>;

async function fillValid(user: User) {
  await user.type(screen.getByLabelText("Project title"), "Smart Attendance");
  await user.type(
    screen.getByLabelText("Short project description"),
    "A system that marks attendance using face recognition.",
  );
  await user.type(
    screen.getByLabelText("GitHub repository URL"),
    "https://github.com/octocat/hello-world",
  );
}

const okSubmit = () =>
  vi.fn<() => Promise<ProjectSubmitResult>>().mockResolvedValue({ ok: true });

describe("ProjectForm", () => {
  it("renders only title, description, repo URL and fixed duration", () => {
    render(<ProjectForm onSubmit={okSubmit()} />);
    expect(screen.getAllByLabelText("Project title")).toHaveLength(1);
    expect(screen.queryByLabelText("Project topic")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Short project description")).toBeInTheDocument();
    expect(screen.getByLabelText("GitHub repository URL")).toBeInTheDocument();
    const duration = screen.getByLabelText("Project duration");
    expect(duration).toHaveValue("12 weeks");
    expect(duration).toHaveAttribute("readonly");
  });

  it("shows required-field errors and does not submit when empty", async () => {
    const onSubmit = okSubmit();
    const user = userEvent.setup();
    render(<ProjectForm onSubmit={onSubmit} />);
    await user.click(screen.getByRole("button", { name: "Create project" }));
    expect(screen.getAllByRole("alert")).toHaveLength(3);
    expect(screen.getByText("Project title is required.")).toBeInTheDocument();
    expect(screen.getByLabelText("Project title")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("rejects a non-GitHub repository URL without submitting", async () => {
    const onSubmit = okSubmit();
    const user = userEvent.setup();
    render(<ProjectForm onSubmit={onSubmit} />);
    await fillValid(user);
    const url = screen.getByLabelText("GitHub repository URL");
    await user.clear(url);
    await user.type(url, "https://gitlab.com/a/b");
    await user.click(screen.getByRole("button", { name: "Create project" }));
    expect(screen.getByRole("alert")).toHaveTextContent(
      /valid GitHub repository URL/,
    );
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("submits validated values (duration 12) and shows success", async () => {
    const onSubmit = okSubmit();
    const user = userEvent.setup();
    render(<ProjectForm onSubmit={onSubmit} />);
    await fillValid(user);
    await user.click(screen.getByRole("button", { name: "Create project" }));
    expect(onSubmit).toHaveBeenCalledWith({
      title: "Smart Attendance",
      description: "A system that marks attendance using face recognition.",
      repoUrl: "https://github.com/octocat/hello-world",
      durationWeeks: 12,
    });
    expect(await screen.findByRole("status")).toHaveTextContent(
      /Project created/,
    );
    expect(screen.getByLabelText("Project title")).toHaveValue("");
  });

  it("disables the button while submitting to prevent double submits", async () => {
    let resolve: (r: ProjectSubmitResult) => void = () => {};
    const onSubmit = vi.fn(
      () => new Promise<ProjectSubmitResult>((r) => (resolve = r)),
    );
    const user = userEvent.setup();
    render(<ProjectForm onSubmit={onSubmit} />);
    await fillValid(user);
    await user.click(screen.getByRole("button", { name: "Create project" }));
    const busy = screen.getByRole("button", { name: "Creating…" });
    expect(busy).toBeDisabled();
    await user.click(busy);
    expect(onSubmit).toHaveBeenCalledTimes(1);
    resolve({ ok: true });
    expect(
      await screen.findByRole("button", { name: "Create project" }),
    ).toBeEnabled();
  });

  it("shows server errors and keeps the entered values", async () => {
    const onSubmit = vi
      .fn<() => Promise<ProjectSubmitResult>>()
      .mockResolvedValue({ ok: false, message: "Storage is not configured." });
    const user = userEvent.setup();
    render(<ProjectForm onSubmit={onSubmit} />);
    await fillValid(user);
    await user.click(screen.getByRole("button", { name: "Create project" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Storage is not configured.",
    );
    expect(screen.getByLabelText("Project title")).toHaveValue(
      "Smart Attendance",
    );
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("shows a network error message if onSubmit throws", async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error("boom"));
    const user = userEvent.setup();
    render(<ProjectForm onSubmit={onSubmit} />);
    await fillValid(user);
    await user.click(screen.getByRole("button", { name: "Create project" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /Could not reach the server/,
    );
  });

  it("clears the form on reset", async () => {
    const user = userEvent.setup();
    render(<ProjectForm onSubmit={okSubmit()} />);
    await fillValid(user);
    await user.click(screen.getByRole("button", { name: "Reset" }));
    expect(screen.getByLabelText("Project title")).toHaveValue("");
  });
});
