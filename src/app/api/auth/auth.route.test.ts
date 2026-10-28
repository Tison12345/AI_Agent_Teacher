// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const jar = vi.hoisted(() => ({ set: vi.fn(), delete: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => jar }));

import { parseSession, SESSION_COOKIE } from "@/lib/auth/session";
import { POST as login } from "./login/route";
import { POST as logout } from "./logout/route";

const post = (body: unknown) =>
  login(new Request("http://localhost/api/auth/login", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) }));

beforeEach(() => vi.clearAllMocks());

describe("POST /api/auth/login (demo sign-in)", () => {
  it("signs a student in with an email and the demo password: sets the cookie and sends them to the student dashboard", async () => {
    const res = await post({ role: "student", email: " Asha.Fictional@Gmail.com ", password: "1234" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ session: { role: "student", email: "asha.fictional@gmail.com" }, redirect: "/student" });
    const [name, value, options] = jar.set.mock.calls[0];
    expect(name).toBe(SESSION_COOKIE);
    expect(parseSession(value)).toEqual({ role: "student", email: "asha.fictional@gmail.com" });
    expect(options).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/" });
    expect(options.maxAge).toBeGreaterThan(0);
  });

  it("signs faculty in the same way and sends them to the faculty dashboard", async () => {
    const res = await post({ role: "faculty", email: "dr.rao@college.edu", password: "1234" });
    expect((await res.json()).redirect).toBe("/faculty");
  });

  it("goes back to the page the user was sent away from, but only one of their own role's pages", async () => {
    expect((await (await post({ role: "student", email: "asha@gmail.com", password: "1234", next: "/student/assignments/abc" })).json()).redirect).toBe("/student/assignments/abc");
    expect((await (await post({ role: "student", email: "asha@gmail.com", password: "1234", next: "/faculty" })).json()).redirect).toBe("/student");
    expect((await (await post({ role: "faculty", email: "dr.rao@college.edu", password: "1234", next: "https://evil.example" })).json()).redirect).toBe("/faculty");
  });

  it("refuses a wrong password with 401 and sets no cookie", async () => {
    const res = await post({ role: "faculty", email: "dr.rao@college.edu", password: "letmein" });
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: { code: "invalid_credentials", fields: { password: "Wrong password." } } });
    expect(jar.set).not.toHaveBeenCalled();
  });

  it("names the fields that are missing or wrong with 400, and sets no cookie", async () => {
    const res = await post({ role: "admin", email: "", password: "" });
    expect(res.status).toBe(400);
    expect(Object.keys((await res.json()).error.fields).sort()).toEqual(["email", "password", "role"]);
    expect(jar.set).not.toHaveBeenCalled();
  });

  it("refuses a body that is not JSON", async () => {
    expect((await post("{nope")).status).toBe(400);
    expect(jar.set).not.toHaveBeenCalled();
  });
});

describe("POST /api/auth/logout", () => {
  it("removes the cookie", async () => {
    const res = await logout();
    expect(res.status).toBe(200);
    expect(jar.delete).toHaveBeenCalledWith(SESSION_COOKIE);
  });
});

describe("a name is not an email", () => {
  it("refuses a sign-in that sends a name instead", async () => {
    const res = await post({ role: "student", name: "Asha Fictional", password: "1234" });
    expect(res.status).toBe(400);
    expect((await res.json()).error.fields.email).toBe("Enter your email.");
    expect(jar.set).not.toHaveBeenCalled();
  });

  it("refuses an email that is not an email", async () => {
    const res = await post({ role: "student", email: "asha", password: "1234" });
    expect(res.status).toBe(400);
    expect((await res.json()).error.fields.email).toMatch(/valid email/);
  });
});
