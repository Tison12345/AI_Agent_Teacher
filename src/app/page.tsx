import Link from "next/link";

const cards = [
  {
    href: "/student",
    title: "Student Dashboard",
    body: "Create a project and, in later phases, track your 12-week plan and results.",
  },
  {
    href: "/faculty",
    title: "Faculty Dashboard",
    body: "Review AI-suggested evaluations and approve official marks (coming in a later phase).",
  },
];

export default function Home() {
  return (
    <div className="space-y-8">
      <section>
        <h1 className="text-3xl font-semibold tracking-tight">
          Human–AI Co-Learning Agent
        </h1>
        <p className="mt-3 max-w-2xl text-slate-600">
          Students push code to GitHub and complete each week. The AI suggests
          an evaluation from the code changes; the teacher&apos;s approved
          score is the official result.
        </p>
      </section>
      <section className="grid gap-4 sm:grid-cols-2">
        {cards.map((card) => (
          <Link
            key={card.href}
            href={card.href}
            className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm hover:border-indigo-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-600"
          >
            <h2 className="font-medium text-indigo-700">{card.title}</h2>
            <p className="mt-2 text-sm text-slate-600">{card.body}</p>
          </Link>
        ))}
      </section>
    </div>
  );
}
