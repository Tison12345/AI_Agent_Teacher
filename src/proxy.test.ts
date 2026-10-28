// @vitest-environment node
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { serializeSession, SESSION_COOKIE, type Session } from "@/lib/auth/session";
import { proxy } from "./proxy";

const student: Session = { role: "student", email: "asha.fictional@gmail.com" };
const faculty: Session = { role: "faculty", email: "dr.rao@college.edu" };

function call(path: string, session?: Session | string) {
  const headers: Record<string, string> = {};
  if (session) headers.cookie = `${SESSION_COOKIE}=${typeof session === "string" ? session : serializeSession(session)}`;
  return proxy(new NextRequest(`http://localhost:3000${path}`, { headers }));
}
const location = (res: Response) => (res.headers.get("location") ? new URL(res.headers.get("location")!) : null);
const passes = (res: Response) => res.headers.get("x-middleware-next") === "1";

describe("student pages", () => {
  it("are open to a student", () => {
    for (const path of ["/student", "/student/assignments", "/student/projects/1"]) expect(passes(call(path, student))).toBe(true);
  });

  it("send a signed-out visitor to the sign-in page, remembering where they were going", () => {
    const res = call("/student/assignments/abc?tab=1");
    expect(res.status).toBe(307);
    const url = location(res)!;
    expect(url.pathname).toBe("/login");
    expect(url.searchParams.get("next")).toBe("/student/assignments/abc?tab=1");
    expect(url.searchParams.get("role")).toBe("student");
    expect(url.searchParams.has("need")).toBe(false);
  });

  it("send a faculty user to the sign-in page too, saying which role the page needs", () => {
    const url = location(call("/student", faculty))!;
    expect(url.pathname).toBe("/login");
    expect(url.searchParams.get("need")).toBe("student");
  });
});

describe("faculty pages and the faculty API", () => {
  it("are open to faculty", () => {
    for (const path of ["/faculty", "/faculty/assignments", "/faculty/submissions/1", "/api/faculty/evaluations"]) expect(passes(call(path, faculty))).toBe(true);
  });

  it("send a student or a signed-out visitor to the sign-in page", () => {
    expect(location(call("/faculty"))!.pathname).toBe("/login");
    const url = location(call("/faculty/submissions/1", student))!;
    expect(url.pathname).toBe("/login");
    expect(url.searchParams.get("need")).toBe("faculty");
  });

  it("answer an API call with 401 when signed out and 403 for a student, never a redirect", async () => {
    const signedOut = call("/api/faculty/evaluations");
    expect(signedOut.status).toBe(401);
    expect((await signedOut.json()).error.code).toBe("unauthorized");
    const wrongRole = call("/api/faculty/submissions/1/decision", student);
    expect(wrongRole.status).toBe(403);
    expect((await wrongRole.json()).error.code).toBe("forbidden");
  });
});

describe("a cookie that is not ours", () => {
  it.each(["student", "%7B%7D", "garbage", encodeURIComponent('{"role":"admin","email":"a@b.co"}'), encodeURIComponent('{"role":"faculty","name":"Dr Rao"}')])("%s does not sign anyone in", (value) => {
    expect(location(call("/faculty", value))!.pathname).toBe("/login");
  });
});

describe("the sign-in page", () => {
  it("is open to a signed-out visitor", () => {
    expect(passes(call("/login"))).toBe(true);
    expect(passes(call("/login?next=/student&role=student"))).toBe(true);
  });

  it("sends a signed-in user to their dashboard", () => {
    expect(location(call("/login", student))!.pathname).toBe("/student");
    expect(location(call("/login", faculty))!.pathname).toBe("/faculty");
  });

  it("stays open for a signed-in user who was sent here for the other role's page", () => {
    expect(passes(call("/login?need=faculty&next=/faculty", student))).toBe(true);
  });
});
