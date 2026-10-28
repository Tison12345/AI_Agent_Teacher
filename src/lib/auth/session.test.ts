import { describe, expect, it } from "vitest";
import { checkLogin, DEMO_PASSWORD, displayName, parseSession, requiredRole, safeNext, serializeSession } from "./session";

describe("session cookie", () => {
  it("round-trips a signed-in user, and lower-cases the email", () => {
    for (const email of ["asha.fictional@gmail.com", "dr.rao+demo@college.edu.in", "ZOE@Example.COM"]) {
      expect(parseSession(serializeSession({ role: "student", email }))).toEqual({ role: "student", email: email.toLowerCase() });
    }
  });

  it("ignores anything that is not what the app wrote, including an old cookie that held a name", () => {
    for (const raw of [undefined, null, "", "student", "{}", "%7B%7D", "not json", encodeURIComponent('{"role":"admin","email":"a@b.co"}'), encodeURIComponent('{"role":"faculty","email":"not-an-email"}'), encodeURIComponent('{"role":"faculty","name":"Dr Rao"}'), "%E0%A4%A"]) {
      expect(parseSession(raw)).toBeNull();
    }
  });

  it("keeps only the role and the email, whatever else the cookie holds", () => {
    const raw = encodeURIComponent(JSON.stringify({ role: "faculty", email: "dr.rao@college.edu", extra: "x", isAdmin: true }));
    expect(parseSession(raw)).toEqual({ role: "faculty", email: "dr.rao@college.edu" });
  });
});

describe("checkLogin", () => {
  const good = { role: "student", email: "  Asha.Fictional@Gmail.com ", password: DEMO_PASSWORD };

  it("accepts either role with the demo password, and trims and lower-cases the email", () => {
    expect(checkLogin(good)).toEqual({ ok: true, session: { role: "student", email: "asha.fictional@gmail.com" } });
    expect(checkLogin({ ...good, role: "faculty", email: "dr.rao@college.edu.in" })).toEqual({ ok: true, session: { role: "faculty", email: "dr.rao@college.edu.in" } });
  });

  it("accepts Gmail and any other address", () => {
    for (const email of ["a@gmail.com", "first.last+tag@sub.example.org", "x_y-z@college.ac.in"]) expect(checkLogin({ ...good, email }).ok).toBe(true);
  });

  it("the demo password is 1234", () => {
    expect(DEMO_PASSWORD).toBe("1234");
  });

  it.each(["", "12345", "123", " 1234", "admin"])("refuses the password %j", (password) => {
    const result = checkLogin({ ...good, password });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(Object.keys(result.fields)).toEqual(["password"]);
  });

  it.each(["", "asha", "asha@", "@gmail.com", "asha@gmail", "two words@gmail.com", "a@b@c.com"])("refuses the email %j", (email) => {
    const result = checkLogin({ ...good, email });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(Object.keys(result.fields)).toEqual(["email"]);
  });

  it("a typed name is not an email", () => {
    expect(checkLogin({ role: "student", name: "Asha Fictional", password: "1234" }).ok).toBe(false);
  });

  it("names every field that is wrong", () => {
    const result = checkLogin({ role: "admin", email: " ", password: "" });
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(Object.keys(result.fields).sort()).toEqual(["email", "password", "role"]);
  });

  it("rejects a missing body and an email that is too long", () => {
    expect(checkLogin(null).ok).toBe(false);
    expect(checkLogin({ ...good, email: `${"x".repeat(250)}@gmail.com` }).ok).toBe(false);
  });
});

describe("displayName", () => {
  it.each([
    ["asha.fictional@gmail.com", "Asha Fictional"],
    ["dr_rao-kumar+demo@college.edu", "Dr Rao Kumar"],
    ["zoe@example.com", "Zoe"],
    ["@x.com", ""],
  ])("%s shows as %j", (email, name) => {
    expect(displayName(email)).toBe(name);
  });
});

describe("requiredRole", () => {
  it.each([
    ["/student", "student"],
    ["/student/assignments/abc", "student"],
    ["/faculty", "faculty"],
    ["/faculty/submissions/1", "faculty"],
    ["/api/faculty/evaluations", "faculty"],
    ["/", null],
    ["/login", null],
    ["/api/projects", null],
    ["/students-archive", null],
    ["/faculty-news", null],
  ])("%s needs %s", (path, role) => {
    expect(requiredRole(path)).toBe(role);
  });
});

describe("safeNext", () => {
  it("returns the page the user was sent away from, if it is one of their role's pages", () => {
    expect(safeNext("/student/assignments/abc?x=1", "student")).toBe("/student/assignments/abc?x=1");
    expect(safeNext("/faculty/submissions/1", "faculty")).toBe("/faculty/submissions/1");
  });

  it("otherwise the dashboard: other role's page, other sites, odd URLs, the API, nothing", () => {
    expect(safeNext("/faculty", "student")).toBe("/student");
    for (const next of ["https://evil.example/student", "//evil.example", "/\evil.example", "student", "/api/faculty/x", "/", "javascript:alert(1)", "", null, undefined]) {
      expect(safeNext(next as string, "faculty")).toBe("/faculty");
    }
  });
});
