import { describe, expect, it } from "vitest";
import { parseGitHubRepoUrl, validateProjectForm } from "./project";

const valid = {
  title: "Smart Attendance",
  description: "A system that marks attendance using face recognition.",
  repoUrl: "https://github.com/octocat/hello-world",
};

describe("parseGitHubRepoUrl", () => {
  it.each([
    ["https://github.com/octocat/hello-world", "octocat", "hello-world"],
    ["https://github.com/octocat/hello-world/", "octocat", "hello-world"],
    ["https://github.com/octocat/hello-world.git", "octocat", "hello-world"],
    ["  https://github.com/octocat/my.repo_1  ", "octocat", "my.repo_1"],
  ])("accepts %s", (url, owner, repo) => {
    expect(parseGitHubRepoUrl(url)).toEqual({ owner, repo });
  });

  it.each([
    "",
    "github.com/octocat/hello",
    "http://github.com/octocat/hello",
    "https://gitlab.com/octocat/hello",
    "https://github.com/octocat",
    "https://github.com/octocat/hello/tree/main",
    "https://github.com.evil.com/octocat/hello",
    "https://github.com/octocat/..",
    "https://github.com/-bad/hello",
  ])("rejects %j", (url) => {
    expect(parseGitHubRepoUrl(url)).toBeNull();
  });
});

describe("validateProjectForm", () => {
  it("accepts valid input and fixes duration at 12 weeks", () => {
    const result = validateProjectForm(valid);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.durationWeeks).toBe(12);
  });

  it("trims whitespace", () => {
    const result = validateProjectForm({ ...valid, title: "  Hello  " });
    expect(result.success && result.data.title).toBe("Hello");
  });

  it("reports required errors for empty fields", () => {
    const result = validateProjectForm({
      title: "",
      description: "",
      repoUrl: "",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.title).toBe("Project title is required.");
      expect(result.errors.description).toBe(
        "Project description is required.",
      );
      expect(result.errors.repoUrl).toBe("GitHub repository URL is required.");
    }
  });

  it("rejects a short description and invalid URL", () => {
    const result = validateProjectForm({
      ...valid,
      description: "too short",
      repoUrl: "https://example.com/a/b",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.description).toMatch(/at least 20/);
      expect(result.errors.repoUrl).toMatch(/valid GitHub repository URL/);
      expect(result.errors.title).toBeUndefined();
    }
  });
});
