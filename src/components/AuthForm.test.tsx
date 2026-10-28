import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const nav = vi.hoisted(() => ({ search: "", replace: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: nav.replace, refresh: nav.refresh }),
  useSearchParams: () => new URLSearchParams(nav.search),
}));
const api = vi.hoisted(() => ({ login: vi.fn(), signup: vi.fn() }));
vi.mock("@/lib/api/client", () => api);

import { AuthForm } from "./AuthForm";

const student = { id: "11111111-1111-4111-8111-111111111111", role: "student", email: "asha.fictional@gmail.com", name: "Asha Fictional" } as const;
const faculty = { id: "22222222-2222-4222-8222-222222222222", role: "faculty", email: "dr.rao@college.edu", name: "Dr Rao" } as const;

beforeEach(() => {
  vi.clearAllMocks();
  nav.search = "";
  window.localStorage.clear();
});

const setup = () => ({ user: userEvent.setup(), ...render(<AuthForm />) });
const submit = (name: string) => screen.getByRole("button", { name });

describe("the page is simple", () => {
  it("shows a plain heading, the two roles with only their names, and no helper or demo text", () => {
    const { container } = setup();
    expect(screen.getByRole("heading", { level: 1, name: "Sign in" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Student" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Faculty" })).not.toBeChecked();
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
    const text = container.textContent ?? "";
    for (const gone of [/demo/i, /1234/, /demonstration/i, /not real security/i, /Gmail or any/i, /Create projects/i, /Review AI/i, /No account is created/i]) {
      expect(text).not.toMatch(gone);
    }
  });

  it("has Sign in and Sign up tabs, starting on Sign in", () => {
    setup();
    expect(screen.getByRole("tab", { name: "Sign in" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Sign up" })).toHaveAttribute("aria-selected", "false");
    expect(screen.queryByLabelText("Full name")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Confirm password")).not.toBeInTheDocument();
  });

  it("opens on Sign up when the address says so", () => {
    nav.search = "mode=signup";
    setup();
    expect(screen.getByRole("heading", { level: 1, name: "Sign up" })).toBeInTheDocument();
    expect(screen.getByLabelText("Full name")).toBeInTheDocument();
  });
});

describe("Sign in", () => {
  it("signs a student in, starts the student pages from their name, and goes where the server says", async () => {
    api.login.mockResolvedValue({ ok: true, session: student, redirect: "/student" });
    const { user } = setup();
    await user.type(screen.getByLabelText("Email"), "asha.fictional@gmail.com");
    await user.type(screen.getByLabelText("Password"), "secret1");
    await user.click(submit("Sign in"));
    expect(api.login).toHaveBeenCalledWith({ role: "student", email: "asha.fictional@gmail.com", password: "secret1", next: null });
    expect(api.signup).not.toHaveBeenCalled();
    expect(nav.replace).toHaveBeenCalledWith("/student");
    expect(nav.refresh).toHaveBeenCalled();
    expect(window.localStorage.getItem("coLearning.studentName")).toBe("Asha Fictional");
  });

  it("signs faculty in without touching the student name", async () => {
    api.login.mockResolvedValue({ ok: true, session: faculty, redirect: "/faculty" });
    const { user } = setup();
    await user.click(screen.getByRole("radio", { name: "Faculty" }));
    await user.type(screen.getByLabelText("Email"), "dr.rao@college.edu");
    await user.type(screen.getByLabelText("Password"), "secret1");
    await user.click(submit("Sign in"));
    expect(api.login).toHaveBeenCalledWith({ role: "faculty", email: "dr.rao@college.edu", password: "secret1", next: null });
    expect(nav.replace).toHaveBeenCalledWith("/faculty");
    expect(window.localStorage.getItem("coLearning.studentName")).toBeNull();
  });

  it("shows the server's message next to the field and stays on the page", async () => {
    api.login.mockResolvedValue({ ok: false, message: "Wrong email or password.", fields: { password: "Wrong email or password." } });
    const { user } = setup();
    await user.type(screen.getByLabelText("Email"), "asha.fictional@gmail.com");
    await user.type(screen.getByLabelText("Password"), "nope");
    await user.click(submit("Sign in"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Wrong email or password.");
    expect(screen.getByLabelText("Password")).toHaveAttribute("aria-invalid", "true");
    expect(nav.replace).not.toHaveBeenCalled();
    expect(submit("Sign in")).toBeEnabled();
  });

  it("shows a message that has no field (accounts not set up) and a network failure", async () => {
    api.login.mockResolvedValueOnce({ ok: false, message: "Accounts are not set up on the server yet." });
    const { user } = setup();
    await user.click(submit("Sign in"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Accounts are not set up");
    api.login.mockRejectedValueOnce(new Error("network"));
    await user.click(submit("Sign in"));
    expect(await screen.findByText(/Could not reach the server/)).toBeInTheDocument();
    expect(submit("Sign in")).toBeEnabled();
  });

  it("starts on the role the page needs, passes on where the user was going, and says why they are here", async () => {
    nav.search = "next=%2Ffaculty%2Fsubmissions%2F1&role=faculty&need=faculty";
    api.login.mockResolvedValue({ ok: true, session: faculty, redirect: "/faculty/submissions/1" });
    const { user } = setup();
    expect(screen.getByRole("radio", { name: "Faculty" })).toBeChecked();
    expect(screen.getByRole("alert")).toHaveTextContent("That page is for faculty users");
    await user.type(screen.getByLabelText("Email"), "dr.rao@college.edu");
    await user.type(screen.getByLabelText("Password"), "secret1");
    await user.click(submit("Sign in"));
    expect(api.login).toHaveBeenCalledWith(expect.objectContaining({ next: "/faculty/submissions/1" }));
    expect(nav.replace).toHaveBeenCalledWith("/faculty/submissions/1");
  });

  it("ignores a role in the address that is not one of the two", () => {
    nav.search = "role=admin";
    setup();
    expect(screen.getByRole("radio", { name: "Student" })).toBeChecked();
  });
});

describe("Sign up", () => {
  async function openSignUp(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole("tab", { name: "Sign up" }));
  }

  it("switches to the sign-up form: full name, email, password and confirm password", async () => {
    const { user } = setup();
    await openSignUp(user);
    expect(screen.getByRole("tab", { name: "Sign up" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("heading", { level: 1, name: "Sign up" })).toBeInTheDocument();
    for (const label of ["Full name", "Email", "Password", "Confirm password"]) expect(screen.getByLabelText(label)).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Student" })).toBeChecked();
  });

  it("creates the account through the sign-up request (not the sign-in one), signs the user in and goes to the dashboard", async () => {
    api.signup.mockResolvedValue({ ok: true, session: student, redirect: "/student" });
    const { user } = setup();
    await openSignUp(user);
    await user.type(screen.getByLabelText("Full name"), "Asha Fictional");
    await user.type(screen.getByLabelText("Email"), "asha.fictional@gmail.com");
    await user.type(screen.getByLabelText("Password"), "secret1");
    await user.type(screen.getByLabelText("Confirm password"), "secret1");
    await user.click(submit("Sign up"));
    expect(api.signup).toHaveBeenCalledWith({ role: "student", fullName: "Asha Fictional", email: "asha.fictional@gmail.com", password: "secret1", confirmPassword: "secret1", next: null });
    expect(api.login).not.toHaveBeenCalled();
    expect(nav.replace).toHaveBeenCalledWith("/student");
    expect(window.localStorage.getItem("coLearning.studentName")).toBe("Asha Fictional");
  });

  it("creates a faculty account", async () => {
    api.signup.mockResolvedValue({ ok: true, session: faculty, redirect: "/faculty" });
    const { user } = setup();
    await openSignUp(user);
    await user.click(screen.getByRole("radio", { name: "Faculty" }));
    await user.type(screen.getByLabelText("Full name"), "Dr Rao");
    await user.type(screen.getByLabelText("Email"), "dr.rao@college.edu");
    await user.type(screen.getByLabelText("Password"), "secret1");
    await user.type(screen.getByLabelText("Confirm password"), "secret1");
    await user.click(submit("Sign up"));
    expect(api.signup).toHaveBeenCalledWith(expect.objectContaining({ role: "faculty", fullName: "Dr Rao" }));
    expect(nav.replace).toHaveBeenCalledWith("/faculty");
  });

  it("shows each field's error from the server, including an email that already has an account", async () => {
    api.signup.mockResolvedValue({
      ok: false,
      message: "Please fix the highlighted fields.",
      fields: { email: "An account with this email already exists. Sign in instead.", confirmPassword: "The passwords do not match." },
    });
    const { user } = setup();
    await openSignUp(user);
    await user.click(submit("Sign up"));
    const alerts = await screen.findAllByRole("alert");
    expect(alerts.map((a) => a.textContent).join(" ")).toMatch(/already exists/);
    expect(alerts.map((a) => a.textContent).join(" ")).toMatch(/do not match/);
    expect(screen.getByLabelText("Email")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("Confirm password")).toHaveAttribute("aria-invalid", "true");
    expect(nav.replace).not.toHaveBeenCalled();
  });

  it("switching tabs clears the passwords and errors but keeps the email and the role", async () => {
    api.signup.mockResolvedValue({ ok: false, message: "x", fields: { fullName: "Enter your full name (at least 2 characters)." } });
    const { user } = setup();
    await user.click(screen.getByRole("radio", { name: "Faculty" }));
    await openSignUp(user);
    await user.type(screen.getByLabelText("Email"), "dr.rao@college.edu");
    await user.type(screen.getByLabelText("Password"), "secret1");
    await user.click(submit("Sign up"));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "Sign in" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toHaveValue("dr.rao@college.edu");
    expect(screen.getByLabelText("Password")).toHaveValue("");
    expect(screen.getByRole("radio", { name: "Faculty" })).toBeChecked();
  });
});
