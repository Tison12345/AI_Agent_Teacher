// @vitest-environment node
import { NextRequest } from "next/server";
import { beforeAll, describe, expect, it } from "vitest";
import { SESSION_COOKIE, type Session } from "@/lib/auth/session";
import { signSession } from "@/lib/auth/token";
import { proxy } from "./proxy";

const SECRET = "proxy-test-secret-0123456789";
const student: Session = { id: "11111111-1111-4111-8111-111111111111", role: "student", email: "asha.fictional@gmail.com", name: "Asha Fictional" };
const faculty: Session = { id: "22222222-2222-4222-8222-222222222222", role: "faculty", email: "dr.rao@college.edu", name: "Dr Rao" };

beforeAll(() => {
  process.env.AUTH_SECRET = SECRET;
});

/** `session` is a user to sign in as, or the raw cookie value to send. */
function call(path: string, session?: Session | string) {
  const headers: Record<string, string> = {};
  if (session) headers.cookie = `${SESSION_COOKIE}=${typeof session === "string" ? session : signSession(session, SECRET)}`;
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

describe("a cookie that is not a genuine sign-in", () => {
  const forgedAsFaculty = Buffer.from(JSON.stringify({ ...faculty, exp: 4_000_000_000 })).toString("base64url");

  it.each([
    ["a plain role", "faculty"],
    ["old unsigned JSON", encodeURIComponent(JSON.stringify(faculty))],
    ["a payload with no signature", forgedAsFaculty],
    ["a payload with a made-up signature", `${forgedAsFaculty}.AAAA`],
    ["a student's signature moved onto a faculty payload", `${forgedAsFaculty}.${signSession(student, SECRET).split(".")[1]}`],
    ["a cookie signed with another secret", signSession(faculty, "another-secret-0123456789")],
  ])("%s does not sign anyone in", async (_label, value) => {
    expect(location(call("/faculty", value))!.pathname).toBe("/login");
    expect((call("/api/faculty/evaluations", value)).status).toBe(401);
  });

  it("an expired sign-in does not work", () => {
    const old = signSession(faculty, SECRET, Date.now() - 9 * 60 * 60 * 1000);
    expect(location(call("/faculty", old))!.pathname).toBe("/login");
  });
});

describe("the sign-in page", () => {
  it("is open to a signed-out visitor", () => {
    expect(passes(call("/login"))).toBe(true);
    expect(passes(call("/login?next=/student&role=student&mode=signup"))).toBe(true);
  });

  it("sends a signed-in user to their dashboard", () => {
    expect(location(call("/login", student))!.pathname).toBe("/student");
    expect(location(call("/login", faculty))!.pathname).toBe("/faculty");
  });

  it("stays open for a signed-in user who was sent here for the other role's page", () => {
    expect(passes(call("/login?need=faculty&next=/faculty", student))).toBe(true);
  });
});
