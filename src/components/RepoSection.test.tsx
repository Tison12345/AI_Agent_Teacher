import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { RepoInfo } from "@/lib/schemas/repo-info";

const api = vi.hoisted(() => ({ fetchRepoInfo: vi.fn() }));
vi.mock("@/lib/api/client", () => api);

import { RepoSection } from "./RepoSection";

const info: RepoInfo = {
  repository: {
    fullName: "octocat/hello-world",
    isPrivate: false,
    defaultBranch: "main",
    htmlUrl: "https://github.com/octocat/hello-world",
    archived: false,
  },
  head: { sha: "b".repeat(40), branch: "main", message: "Add parser", date: null },
  isEmpty: false,
  authenticated: false,
  rateLimit: { limit: 60, remaining: 58, resetAt: "2027-01-01T00:00:00.000Z" },
};

beforeEach(() => vi.clearAllMocks());

describe("RepoSection", () => {
  it("does not call GitHub until the button is clicked", () => {
    render(<RepoSection projectId="p" />);
    expect(api.fetchRepoInfo).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Check repository" })).toBeEnabled();
  });

  it("shows loading, then repository details", async () => {
    let resolve: (i: RepoInfo) => void = () => {};
    api.fetchRepoInfo.mockReturnValue(new Promise<RepoInfo>((r) => (resolve = r)));
    const user = userEvent.setup();
    render(<RepoSection projectId="p" />);
    await user.click(screen.getByRole("button", { name: "Check repository" }));
    expect(screen.getByRole("button", { name: "Checking…" })).toBeDisabled();
    resolve(info);
    expect(await screen.findByRole("link", { name: "octocat/hello-world" })).toBeInTheDocument();
    expect(screen.getByText("Public")).toBeInTheDocument();
    expect(screen.getByText("main")).toBeInTheDocument();
    expect(screen.getByText("bbbbbbb")).toBeInTheDocument();
    expect(screen.getByText(/58 of 60/)).toBeInTheDocument();
  });

  it("explains an empty repository", async () => {
    api.fetchRepoInfo.mockResolvedValue({ ...info, head: null, isEmpty: true });
    const user = userEvent.setup();
    render(<RepoSection projectId="p" />);
    await user.click(screen.getByRole("button", { name: "Check repository" }));
    expect(await screen.findByText(/No commits yet/)).toBeInTheDocument();
  });

  it("shows server errors and lets the user retry", async () => {
    api.fetchRepoInfo
      .mockRejectedValueOnce(new Error("GitHub's rate limit was reached."))
      .mockResolvedValueOnce(info);
    const user = userEvent.setup();
    render(<RepoSection projectId="p" />);
    await user.click(screen.getByRole("button", { name: "Check repository" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("rate limit");
    await user.click(screen.getByRole("button", { name: "Check repository" }));
    expect(await screen.findByText("Public")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
