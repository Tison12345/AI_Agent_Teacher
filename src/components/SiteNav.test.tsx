import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const nav = vi.hoisted(() => ({ pathname: "/", replace: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ usePathname: () => nav.pathname, useRouter: () => ({ replace: nav.replace, refresh: nav.refresh }) }));
const api = vi.hoisted(() => ({ logout: vi.fn() }));
vi.mock("@/lib/api/client", () => api);

import { SiteNav } from "./SiteNav";

const student = { id: "11111111-1111-4111-8111-111111111111", role: "student", email: "asha.fictional@gmail.com", name: "Asha Fictional" } as const;
const faculty = { id: "22222222-2222-4222-8222-222222222222", role: "faculty", email: "dr.rao@college.edu", name: "Dr Rao" } as const;

beforeEach(() => {
  vi.clearAllMocks();
  nav.pathname = "/";
  api.logout.mockResolvedValue(undefined);
});

describe("SiteNav", () => {
  it("a student sees the student sections only, with icons that are hidden from screen readers", () => {
    render(<SiteNav session={student} />);
    const main = screen.getByRole("navigation", { name: "Main" });
    expect(screen.getByRole("link", { name: "Home" })).toHaveAttribute("href", "/");
    expect(screen.getByRole("link", { name: "Student Dashboard" })).toHaveAttribute("href", "/student");
    expect(screen.getByRole("link", { name: "Student Assignments" })).toHaveAttribute("href", "/student/assignments");
    expect(screen.queryByRole("link", { name: /Faculty/ })).not.toBeInTheDocument();
    expect(main.querySelectorAll("svg[aria-hidden='true']").length).toBeGreaterThanOrEqual(3);
  });

  it("faculty see the faculty sections only", () => {
    render(<SiteNav session={faculty} />);
    expect(screen.getByRole("link", { name: "Faculty Dashboard" })).toHaveAttribute("href", "/faculty");
    expect(screen.getByRole("link", { name: "Faculty Assignments" })).toHaveAttribute("href", "/faculty/assignments");
    expect(screen.queryByRole("link", { name: /Student/ })).not.toBeInTheDocument();
  });

  it("signed out shows Home and Sign in, and no dashboards", () => {
    render(<SiteNav session={null} />);
    expect(screen.getByRole("link", { name: "Home" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login");
    expect(screen.queryByRole("link", { name: /Dashboard|Assignments/ })).not.toBeInTheDocument();
    expect(screen.queryByTestId("user-card")).not.toBeInTheDocument();
  });

  it("before the sign-in is known only the logo shows: no links to pages, no Sign in, no buttons", () => {
    render(<SiteNav />);
    expect(screen.getAllByRole("link")).toHaveLength(1); // the logo, which goes home
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("shows the signed-in name and role, with a Log out button", () => {
    render(<SiteNav session={student} />);
    const card = screen.getAllByTestId("user-card")[0];
    expect(card).toHaveTextContent("Asha Fictional");
    expect(card).toHaveTextContent("Student");
    expect(screen.getAllByRole("button", { name: "Log out" }).length).toBeGreaterThanOrEqual(1);
  });

  it("Log out signs out and goes to the sign-in page", async () => {
    render(<SiteNav session={faculty} />);
    await userEvent.setup().click(screen.getAllByRole("button", { name: "Log out" })[0]);
    expect(api.logout).toHaveBeenCalledTimes(1);
    expect(nav.replace).toHaveBeenCalledWith("/login");
    expect(nav.refresh).toHaveBeenCalled();
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
    render(<SiteNav session={pathname.startsWith("/faculty") ? faculty : student} />);
    const marked = screen.getAllByRole("link").filter((link) => link.getAttribute("aria-current") === "page");
    expect(marked.map((l) => l.textContent)).toEqual([current]);
  });

  it("does not mark Home as current on other pages, and a similar prefix is not a match", () => {
    nav.pathname = "/students-archive";
    render(<SiteNav session={student} />);
    expect(screen.getAllByRole("link").filter((link) => link.getAttribute("aria-current") === "page")).toHaveLength(0);
  });
});
