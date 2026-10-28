import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const nav = vi.hoisted(() => ({ pathname: "/" }));
vi.mock("next/navigation", () => ({ usePathname: () => nav.pathname }));

import { SiteNav } from "./SiteNav";

beforeEach(() => {
  nav.pathname = "/";
});

describe("SiteNav", () => {
  it("links to every section, with an icon that is hidden from screen readers", () => {
    render(<SiteNav />);
    const main = screen.getByRole("navigation", { name: "Main" });
    expect(main).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Home" })).toHaveAttribute("href", "/");
    expect(screen.getByRole("link", { name: "Student Dashboard" })).toHaveAttribute("href", "/student");
    expect(screen.getByRole("link", { name: "Faculty Dashboard" })).toHaveAttribute("href", "/faculty");
    expect(screen.getByRole("link", { name: "Student Assignments" })).toHaveAttribute("href", "/student/assignments");
    expect(screen.getByRole("link", { name: "Faculty Assignments" })).toHaveAttribute("href", "/faculty/assignments");
    expect(main.querySelectorAll("svg[aria-hidden='true']").length).toBeGreaterThanOrEqual(5);
  });

  it.each([
    ["/", "Home"],
    ["/student", "Student Dashboard"],
    ["/student/projects/123", "Student Dashboard"],
    ["/faculty", "Faculty Dashboard"],
    ["/faculty/evaluations/abc", "Faculty Dashboard"],
    ["/faculty/projects/abc", "Faculty Dashboard"],
    ["/student/assignments", "Student Assignments"],
    ["/student/assignments/abc", "Student Assignments"],
    ["/faculty/assignments", "Faculty Assignments"],
    ["/faculty/assignments/abc", "Faculty Assignments"],
  ])("on %s the current page is %s, and only that one", (pathname, current) => {
    nav.pathname = pathname;
    render(<SiteNav />);
    const marked = screen.getAllByRole("link").filter((link) => link.getAttribute("aria-current") === "page");
    expect(marked.map((l) => l.textContent)).toEqual([current]);
  });

  it("does not mark Home as current on other pages, and a similar prefix is not a match", () => {
    nav.pathname = "/students-archive";
    render(<SiteNav />);
    expect(screen.getAllByRole("link").filter((link) => link.getAttribute("aria-current") === "page")).toHaveLength(0);
  });
});
