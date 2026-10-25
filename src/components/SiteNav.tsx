import Link from "next/link";

const links = [
  { href: "/", label: "Home" },
  { href: "/student", label: "Student Dashboard" },
  { href: "/faculty", label: "Faculty Dashboard" },
];

export function SiteNav() {
  return (
    <header className="border-b border-slate-200 bg-white">
      <nav
        aria-label="Main"
        className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3"
      >
        <span className="font-semibold text-indigo-700">Co-Learning Agent</span>
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {links.map((link) => (
            <li key={link.href}>
              <Link
                href={link.href}
                className="rounded px-1 text-slate-700 hover:text-indigo-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-600"
              >
                {link.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </header>
  );
}
