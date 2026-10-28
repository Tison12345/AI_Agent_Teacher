import { NextResponse, type NextRequest } from "next/server";
import { requiredRole, ROLE_HOME, ROLE_LABEL, SESSION_COOKIE } from "@/lib/auth/session";
import { authSecret, verifySession } from "@/lib/auth/token";

/*
 * The sign-in gate (see lib/auth/session.ts). Student pages need the student role, faculty pages and the faculty
 * API need the faculty role. Anyone else is sent to the sign-in page, or gets a 401/403 for an API call. The cookie
 * is signed, so it cannot be edited to become another user. Everything else (home, the sign-in page, the
 * student-facing API) is open as before.
 */
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const session = verifySession(request.cookies.get(SESSION_COOKIE)?.value, authSecret());

  if (pathname === "/login") {
    // Already signed in: go to the dashboard, unless sent here because the page belongs to the other role.
    if (session && !request.nextUrl.searchParams.has("need")) return NextResponse.redirect(new URL(ROLE_HOME[session.role], request.url));
    return NextResponse.next();
  }

  const needed = requiredRole(pathname);
  if (!needed || session?.role === needed) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json(
      {
        error: {
          code: session ? "forbidden" : "unauthorized",
          message: session ? `This is for ${ROLE_LABEL[needed].toLowerCase()} users.` : "Sign in first.",
        },
      },
      { status: session ? 403 : 401 },
    );
  }

  const login = new URL("/login", request.url);
  login.searchParams.set("next", `${pathname}${search}`);
  login.searchParams.set("role", needed);
  if (session) login.searchParams.set("need", needed); // signed in as the other role: say so on the page
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ["/login", "/student/:path*", "/faculty/:path*", "/api/faculty/:path*"],
};
