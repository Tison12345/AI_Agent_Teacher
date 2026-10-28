"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense } from "react";
import { Icon, type IconName } from "@/components/ui";

const links: { href: string; label: string; icon: IconName }[] = [
  { href: "/", label: "Home", icon: "home" },
  { href: "/student", label: "Student Dashboard", icon: "student" },
  { href: "/student/assignments", label: "Student Assignments", icon: "doc" },
  { href: "/faculty", label: "Faculty Dashboard", icon: "faculty" },
  { href: "/faculty/assignments", label: "Faculty Assignments", icon: "doc" },
];

/**
 * The current page's section. "/" only matches itself; the others also match their sub-pages, and the most
 * specific link wins, so /student/assignments marks "Student Assignments" and not "Student Dashboard".
 */
function activeHref(pathname: string): string | null {
  const matches = links.filter((l) => (l.href === "/" ? pathname === "/" : pathname === l.href || pathname.startsWith(`${l.href}/`)));
  return matches.sort((a, b) => b.href.length - a.href.length)[0]?.href ?? null;
}

/** The navigation markup. `pathname` is null before the current page is known (no item is marked active). */
function NavShell({ pathname }: { pathname: string | null }) {
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
            const active = pathname !== null && link.href === activeHref(pathname);
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

        <p className="mt-auto hidden text-xs leading-relaxed text-muted lg:block">
          The AI&apos;s score is a recommendation. The teacher&apos;s decision is the official result.
        </p>
      </nav>
    </header>
  );
}

function ActiveNav() {
  return <NavShell pathname={usePathname()} />;
}

/** A sidebar on large screens and a compact top bar on small ones. */
export function SiteNav() {
  // Reading the current path needs a Suspense boundary; the fallback is the same menu with nothing active.
  return (
    <Suspense fallback={<NavShell pathname={null} />}>
      <ActiveNav />
    </Suspense>
  );
}
