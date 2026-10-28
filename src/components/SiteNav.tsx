"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Suspense, useState } from "react";
import { logout } from "@/lib/api/client";
import { ROLE_LABEL, type Role, type Session } from "@/lib/auth/session";
import { Icon, type IconName } from "@/components/ui";

type NavLink = { href: string; label: string; icon: IconName };

const HOME: NavLink = { href: "/", label: "Home", icon: "home" };
/** What each role sees. Signed out: Home and Sign in. The other role's pages are not offered. */
const LINKS: Record<Role, NavLink[]> = {
  student: [HOME, { href: "/student", label: "Student Dashboard", icon: "student" }, { href: "/student/assignments", label: "Student Assignments", icon: "doc" }],
  faculty: [HOME, { href: "/faculty", label: "Faculty Dashboard", icon: "faculty" }, { href: "/faculty/assignments", label: "Faculty Assignments", icon: "doc" }],
};
const SIGNED_OUT: NavLink[] = [HOME, { href: "/login", label: "Sign in", icon: "lock" }];

/** `session`: the signed-in user, null when signed out, undefined while it is not known yet (the logo only). */
function linksFor(session: Session | null | undefined): NavLink[] {
  if (session === undefined) return [];
  return session ? LINKS[session.role] : SIGNED_OUT;
}

/**
 * The current page's section. "/" only matches itself; the others also match their sub-pages, and the most
 * specific link wins, so /student/assignments marks "Student Assignments" and not "Student Dashboard".
 */
function activeHref(pathname: string, links: NavLink[]): string | null {
  const matches = links.filter((l) => (l.href === "/" ? pathname === "/" : pathname === l.href || pathname.startsWith(`${l.href}/`)));
  return matches.sort((a, b) => b.href.length - a.href.length)[0]?.href ?? null;
}

/** The navigation markup. `pathname` is null before the current page is known (no item is marked active). */
function NavShell({ pathname, session }: { pathname: string | null; session: Session | null | undefined }) {
  const links = linksFor(session);
  return (
    <header className="border-b border-line bg-panel/95 backdrop-blur lg:fixed lg:inset-y-0 lg:left-0 lg:z-20 lg:w-64 lg:border-b-0 lg:border-r">
      <nav aria-label="Main" className="flex flex-col gap-3 px-4 py-3 lg:h-full lg:gap-8 lg:px-5 lg:py-7">
        <Link href="/" className="flex items-center gap-3 rounded-lg">
          <span
            aria-hidden="true"
            className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-white shadow-md shadow-primary/30"
            style={{ backgroundImage: "linear-gradient(135deg, var(--color-primary-strong), var(--color-violet-strong))" }}
          >
            <Icon name="spark" className="h-5 w-5" />
          </span>
          <span className="leading-tight">
            <span className="block text-sm font-bold">Co-Learning Agent</span>
            <span className="block text-xs text-muted">Human–AI project reviews</span>
          </span>
        </Link>

        <ul className="flex gap-1 overflow-x-auto lg:flex-col lg:overflow-visible">
          {links.map((link) => {
            const active = pathname !== null && link.href === activeHref(pathname, links);
            return (
              <li key={link.href} className="shrink-0">
                <Link
                  href={link.href}
                  aria-current={active ? "page" : undefined}
                  className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition duration-150 ${
                    active
                      ? "bg-primary/20 text-fg ring-1 ring-primary/40"
                      : "text-muted hover:bg-card hover:text-fg"
                  }`}
                >
                  <Icon name={link.icon} className={`h-5 w-5 ${active ? "text-accent" : ""}`} />
                  {link.label}
                </Link>
              </li>
            );
          })}
        </ul>

        <div className="mt-auto hidden space-y-4 lg:block">
          {session && <UserCard session={session} />}
          <p className="text-xs leading-relaxed text-muted">
            The AI&apos;s score is a recommendation. The teacher&apos;s decision is the official result.
          </p>
        </div>
        {session && (
          <div className="lg:hidden">
            <UserCard session={session} compact />
          </div>
        )}
      </nav>
    </header>
  );
}

/** Who is signed in, and the way out. */
function UserCard({ session, compact = false }: { session: Session; compact?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function handleLogout() {
    if (busy) return;
    setBusy(true);
    await logout().catch(() => {});
    router.replace("/login");
    router.refresh();
  }

  return (
    <div className={`flex items-center justify-between gap-3 rounded-lg border border-line bg-card/60 ${compact ? "px-3 py-2" : "p-3"}`} data-testid="user-card">
      <p className="min-w-0 text-xs leading-tight">
        <span className="block truncate text-sm font-semibold text-fg" title={session.email}>{session.name}</span>
        <span className="block text-muted">{ROLE_LABEL[session.role]}</span>
      </p>
      <button type="button" onClick={handleLogout} disabled={busy} className="btn-secondary btn-sm shrink-0">
        <Icon name="logout" className="h-4 w-4" />
        {busy ? "Signing out…" : "Log out"}
      </button>
    </div>
  );
}

function ActiveNav({ session }: { session: Session | null | undefined }) {
  return <NavShell pathname={usePathname()} session={session} />;
}

/** A sidebar on large screens and a compact top bar on small ones. */
export function SiteNav({ session }: { session?: Session | null }) {
  // Reading the current path needs a Suspense boundary; the fallback is the same menu with nothing active.
  return (
    <Suspense fallback={<NavShell pathname={null} session={session} />}>
      <ActiveNav session={session} />
    </Suspense>
  );
}
