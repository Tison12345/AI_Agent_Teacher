import { describe, expect, it } from "vitest";
import { fieldErrors, requiredRole, safeNext, SignInSchema, SignUpSchema } from "./session";

const signUp = { role: "student", fullName: "  Asha Fictional ", email: "  Asha.Fictional@Gmail.com ", password: "secret1", confirmPassword: "secret1" };

describe("SignInSchema", () => {
  it("accepts a role, an email and a password, and trims and lower-cases the email", () => {
    expect(SignInSchema.parse({ role: "faculty", email: " Dr.Rao@College.EDU ", password: "x" })).toEqual({ role: "faculty", email: "dr.rao@college.edu", password: "x" });
  });

  it.each(["", "asha", "asha@", "@gmail.com", "asha@gmail", "two words@gmail.com", "a@b@c.com"])("refuses the email %j", (email) => {
    const result = SignInSchema.safeParse({ role: "student", email, password: "x" });
    expect(result.success).toBe(false);
    if (!result.success) expect(Object.keys(fieldErrors(result.error))).toEqual(["email"]);
  });

  it("names every field that is wrong, with a message", () => {
    const result = SignInSchema.safeParse({ role: "admin", email: " ", password: "" });
    expect(result.success).toBe(false);
    if (!result.success) {
      const fields = fieldErrors(result.error);
      expect(Object.keys(fields).sort()).toEqual(["email", "password", "role"]);
      expect(fields.role).toBe("Choose Student or Faculty.");
    }
  });
});

describe("SignUpSchema", () => {
  it("accepts a full account and cleans the name and the email", () => {
    expect(SignUpSchema.parse(signUp)).toMatchObject({ role: "student", fullName: "Asha Fictional", email: "asha.fictional@gmail.com", password: "secret1" });
  });

  it.each([
    [{ fullName: "A" }, "fullName"],
    [{ fullName: "x".repeat(81) }, "fullName"],
    [{ email: "asha" }, "email"],
    [{ password: "123", confirmPassword: "123" }, "password"],
    [{ password: "x".repeat(101), confirmPassword: "x".repeat(101) }, "password"],
    [{ confirmPassword: "different" }, "confirmPassword"],
    [{ role: "admin" }, "role"],
  ])("refuses %j, naming %s", (over, field) => {
    const result = SignUpSchema.safeParse({ ...signUp, ...over });
    expect(result.success).toBe(false);
    if (!result.success) expect(Object.keys(fieldErrors(result.error))).toContain(field);
  });

  it("says when the passwords do not match, on the confirm field", () => {
    const result = SignUpSchema.safeParse({ ...signUp, confirmPassword: "nope" });
    if (result.success) throw new Error("should not pass");
    expect(fieldErrors(result.error)).toEqual({ confirmPassword: "The passwords do not match." });
  });

  it("a missing body fails", () => {
    expect(SignUpSchema.safeParse(null).success).toBe(false);
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
    for (const next of ["https://evil.example/student", "//evil.example", "/\\evil.example", "student", "/api/faculty/x", "/", "javascript:alert(1)", "", null, undefined]) {
      expect(safeNext(next as string, "faculty")).toBe("/faculty");
    }
  });
});
