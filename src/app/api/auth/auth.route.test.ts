// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UserRecord, UserStore } from "@/lib/auth/service";

const jar = vi.hoisted(() => ({ set: vi.fn(), delete: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => jar }));

const world = vi.hoisted(() => ({ store: undefined as unknown as UserStore, users: new Map<string, UserRecord>(), unavailable: false }));
vi.mock("@/lib/auth/users", () => ({
  userStore: {
    findByEmail: async (email: string) => {
      if (world.unavailable) throw new (await import("@/lib/auth/service")).AccountsUnavailableError();
      return world.users.get(email) ?? null;
    },
    create: async (user: Omit<UserRecord, "id">) => {
      if (world.users.has(user.email)) throw new (await import("@/lib/auth/service")).EmailTakenError();
      const record = { ...user, id: `00000000-0000-4000-8000-${String(world.users.size + 1).padStart(12, "0")}` };
      world.users.set(user.email, record);
      return record;
    },
  },
}));

import { SESSION_COOKIE } from "@/lib/auth/session";
import { verifySession } from "@/lib/auth/token";
import { POST as login } from "./login/route";
import { POST as logout } from "./logout/route";
import { POST as signup } from "./signup/route";

const SECRET = "route-test-secret-0123456789";
const request = (path: string, body: unknown) =>
  new Request(`http://localhost/api/auth/${path}`, { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) });
const up = (body: unknown) => signup(request("signup", body));
const inn = (body: unknown) => login(request("login", body));

const account = { role: "student", fullName: "Asha Fictional", email: "Asha.Fictional@Gmail.com", password: "secret1", confirmPassword: "secret1" };
const signedCookie = () => jar.set.mock.calls[0]?.[1] as string | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("AUTH_SECRET", SECRET);
  world.users.clear();
  world.unavailable = false;
});

describe("POST /api/auth/signup", () => {
  it("creates the account, signs it in with a signed HttpOnly cookie, and sends a student to the student dashboard", async () => {
    const res = await up(account);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ session: { id: world.users.get("asha.fictional@gmail.com")!.id, role: "student", email: "asha.fictional@gmail.com", name: "Asha Fictional" }, redirect: "/student" });
    const [name, value, options] = jar.set.mock.calls[0];
    expect(name).toBe(SESSION_COOKIE);
    expect(verifySession(value, SECRET)).toEqual({ id: world.users.get("asha.fictional@gmail.com")!.id, role: "student", email: "asha.fictional@gmail.com", name: "Asha Fictional" });
    expect(options).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/" });
    expect(options.maxAge).toBeGreaterThan(0);
    expect(world.users.get("asha.fictional@gmail.com")?.passwordHash).toMatch(/^scrypt\$/);
  });

  it("sends faculty to the faculty dashboard, or back to the faculty page they were sent away from", async () => {
    const faculty = { ...account, role: "faculty", fullName: "Dr Rao", email: "dr.rao@college.edu" };
    expect((await (await up(faculty)).json()).redirect).toBe("/faculty");
    world.users.clear();
    expect((await (await up({ ...faculty, next: "/faculty/submissions/1" })).json()).redirect).toBe("/faculty/submissions/1");
    world.users.clear();
    expect((await (await up({ ...faculty, next: "/student" })).json()).redirect).toBe("/faculty");
  });

  it("refuses a second account for the same email (409) and sets no cookie", async () => {
    await up(account);
    jar.set.mockClear();
    const res = await up({ ...account, role: "faculty" });
    expect(res.status).toBe(409);
    expect((await res.json()).error.fields.email).toMatch(/already exists/);
    expect(jar.set).not.toHaveBeenCalled();
  });

  it("names the fields that are wrong (400) and sets no cookie", async () => {
    const res = await up({ ...account, fullName: "", password: "123", confirmPassword: "x" });
    expect(res.status).toBe(400);
    expect(Object.keys((await res.json()).error.fields).sort()).toEqual(["confirmPassword", "fullName", "password"]);
    expect(jar.set).not.toHaveBeenCalled();
    expect(world.users.size).toBe(0);
  });

  it("answers 503 when the accounts table is missing, and when there is no secret to sign with", async () => {
    world.unavailable = true;
    expect((await up(account)).status).toBe(503);
    world.unavailable = false;
    vi.stubEnv("AUTH_SECRET", "");
    vi.stubEnv("SUPABASE_SECRET_KEY", "");
    const res = await up(account);
    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe("auth_unavailable");
    expect(jar.set).not.toHaveBeenCalled();
  });

  it("refuses a body that is not JSON", async () => {
    expect((await up("{nope")).status).toBe(400);
  });
});

describe("POST /api/auth/login", () => {
  beforeEach(async () => {
    await up(account);
    jar.set.mockClear();
  });

  it("signs in with the email and the password chosen at sign-up", async () => {
    const res = await inn({ role: "student", email: " ASHA.fictional@gmail.com ", password: "secret1" });
    expect(res.status).toBe(200);
    expect((await res.json()).redirect).toBe("/student");
    expect(verifySession(signedCookie(), SECRET)).toMatchObject({ role: "student", name: "Asha Fictional" });
  });

  it("goes back to the page the user was sent away from, but only one of their own role's pages", async () => {
    const body = { role: "student", email: "asha.fictional@gmail.com", password: "secret1" };
    expect((await (await inn({ ...body, next: "/student/assignments/abc" })).json()).redirect).toBe("/student/assignments/abc");
    expect((await (await inn({ ...body, next: "/faculty" })).json()).redirect).toBe("/student");
    expect((await (await inn({ ...body, next: "https://evil.example" })).json()).redirect).toBe("/student");
  });

  it("refuses a wrong password, an unknown email and the old shared password with the same 401, and sets no cookie", async () => {
    const results = await Promise.all([
      inn({ role: "student", email: "asha.fictional@gmail.com", password: "nope" }),
      inn({ role: "student", email: "nobody@gmail.com", password: "secret1" }),
      inn({ role: "student", email: "asha.fictional@gmail.com", password: "1234" }),
    ]);
    for (const res of results) {
      expect(res.status).toBe(401);
      expect((await res.json()).error.fields.password).toBe("Wrong email or password.");
    }
    expect(jar.set).not.toHaveBeenCalled();
  });

  it("refuses the right password under the wrong role, and says which role the account is", async () => {
    const res = await inn({ role: "faculty", email: "asha.fictional@gmail.com", password: "secret1" });
    expect(res.status).toBe(401);
    expect((await res.json()).error.fields.role).toMatch(/Choose Student/);
    expect(jar.set).not.toHaveBeenCalled();
  });

  it("names the fields that are missing (400)", async () => {
    const res = await inn({ role: "admin", email: "", password: "" });
    expect(res.status).toBe(400);
    expect(Object.keys((await res.json()).error.fields).sort()).toEqual(["email", "password", "role"]);
  });

  it("answers 503 when the accounts table is missing", async () => {
    world.unavailable = true;
    expect((await inn({ role: "student", email: "asha.fictional@gmail.com", password: "secret1" })).status).toBe(503);
  });
});

describe("POST /api/auth/logout", () => {
  it("removes the cookie", async () => {
    const res = await logout();
    expect(res.status).toBe(200);
    expect(jar.delete).toHaveBeenCalledWith(SESSION_COOKIE);
  });
});
