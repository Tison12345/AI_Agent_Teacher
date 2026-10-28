import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const nav = vi.hoisted(() => ({ search: "", replace: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: nav.replace, refresh: nav.refresh }),
  useSearchParams: () => new URLSearchParams(nav.search),
}));
const api = vi.hoisted(() => ({ login: vi.fn() }));
vi.mock("@/lib/api/client", () => api);

import { LoginForm } from "./LoginForm";

beforeEach(() => {
  vi.clearAllMocks();
  nav.search = "";
  window.localStorage.clear();
});

const setup = () => ({ user: userEvent.setup(), ...render(<LoginForm />) });
const fill = async (user: ReturnType<typeof userEvent.setup>, email: string, password: string) => {
  await user.type(screen.getByLabelText("Email"), email);
  await user.type(screen.getByLabelText("Password"), password);
};

describe("LoginForm (demo sign-in)", () => {
  it("offers Student and Faculty, starting on Student, and says the password is for demonstration only", () => {
    setup();
    expect(screen.getByRole("radio", { name: /Student/ })).toBeChecked();
    expect(screen.getByRole("radio", { name: /Faculty/ })).not.toBeChecked();
    expect(screen.getByText(/Demonstration only/)).toHaveTextContent("1234");
    expect(screen.getByText(/not real security/i)).toBeInTheDocument();
  });

  it("asks for an email (Gmail or any), not a name, whichever role is chosen", async () => {
    const { user } = setup();
    expect(screen.getByLabelText("Email")).toHaveAttribute("type", "email");
    expect(screen.getByText(/Gmail or any email/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/name/i)).not.toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: /Faculty/ }));
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.queryByLabelText(/name/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign in as faculty" })).toBeInTheDocument();
  });

  it("signs a student in, starts the student pages from a readable name taken from the email, and goes where the server says", async () => {
    api.login.mockResolvedValue({ ok: true, session: { role: "student", email: "asha.fictional@gmail.com" }, redirect: "/student" });
    const { user } = setup();
    await fill(user, "asha.fictional@gmail.com", "1234");
    await user.click(screen.getByRole("button", { name: "Sign in as student" }));
    expect(api.login).toHaveBeenCalledWith({ role: "student", email: "asha.fictional@gmail.com", password: "1234", next: null });
    expect(nav.replace).toHaveBeenCalledWith("/student");
    expect(nav.refresh).toHaveBeenCalled();
    expect(window.localStorage.getItem("coLearning.studentName")).toBe("Asha Fictional");
  });

  it("signs faculty in without touching the student name", async () => {
    api.login.mockResolvedValue({ ok: true, session: { role: "faculty", email: "dr.rao@college.edu" }, redirect: "/faculty" });
    const { user } = setup();
    await user.click(screen.getByRole("radio", { name: /Faculty/ }));
    await fill(user, "dr.rao@college.edu", "1234");
    await user.click(screen.getByRole("button", { name: "Sign in as faculty" }));
    expect(api.login).toHaveBeenCalledWith({ role: "faculty", email: "dr.rao@college.edu", password: "1234", next: null });
    expect(nav.replace).toHaveBeenCalledWith("/faculty");
    expect(window.localStorage.getItem("coLearning.studentName")).toBeNull();
  });

  it("shows an email error next to the email field", async () => {
    api.login.mockResolvedValue({ ok: false, message: "x", fields: { email: "Enter a valid email address, for example you@gmail.com." } });
    const { user } = setup();
    await fill(user, "asha", "1234");
    await user.click(screen.getByRole("button", { name: "Sign in as student" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("valid email address");
    expect(screen.getByLabelText("Email")).toHaveAttribute("aria-invalid", "true");
  });

  it("does not start the student pages from a name when the email gives none", async () => {
    api.login.mockResolvedValue({ ok: true, session: { role: "student", email: "x@gmail.com" }, redirect: "/student" });
    const { user } = setup();
    await fill(user, "x@gmail.com", "1234");
    await user.click(screen.getByRole("button", { name: "Sign in as student" }));
    expect(window.localStorage.getItem("coLearning.studentName")).toBeNull(); // "X" is too short to be a name
  });

  it("shows the field errors from the server and stays on the page", async () => {
    api.login.mockResolvedValue({ ok: false, message: "Wrong password.", fields: { password: "Wrong password." } });
    const { user } = setup();
    await fill(user, "asha.fictional@gmail.com", "nope");
    await user.click(screen.getByRole("button", { name: "Sign in as student" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Wrong password.");
    expect(screen.getByLabelText("Password")).toHaveAttribute("aria-invalid", "true");
    expect(nav.replace).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Sign in as student" })).toBeEnabled();
  });

  it("reports a network failure and lets the user try again", async () => {
    api.login.mockRejectedValue(new Error("network"));
    const { user } = setup();
    await fill(user, "asha.fictional@gmail.com", "1234");
    await user.click(screen.getByRole("button", { name: "Sign in as student" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not reach the server");
    expect(screen.getByRole("button", { name: "Sign in as student" })).toBeEnabled();
  });

  it("starts on the role the page needs, passes on where the user was going, and says why they are here", async () => {
    nav.search = "next=%2Ffaculty%2Fsubmissions%2F1&role=faculty&need=faculty";
    api.login.mockResolvedValue({ ok: true, session: { role: "faculty", email: "dr.rao@college.edu" }, redirect: "/faculty/submissions/1" });
    const { user } = setup();
    expect(screen.getByRole("radio", { name: /Faculty/ })).toBeChecked();
    expect(screen.getByRole("alert")).toHaveTextContent("That page is for faculty users");
    await fill(user, "dr.rao@college.edu", "1234");
    await user.click(screen.getByRole("button", { name: "Sign in as faculty" }));
    expect(api.login).toHaveBeenCalledWith(expect.objectContaining({ next: "/faculty/submissions/1" }));
    expect(nav.replace).toHaveBeenCalledWith("/faculty/submissions/1");
  });

  it("ignores a role in the address that is not one of the two", () => {
    nav.search = "role=admin";
    setup();
    expect(screen.getByRole("radio", { name: /Student/ })).toBeChecked();
  });
});
