import Link from "next/link";
import { Icon, type IconName } from "@/components/ui";

const cards: { href: string; title: string; body: string; icon: IconName; action: string }[] = [
  {
    href: "/student",
    title: "Student Dashboard",
    body: "Create a project, follow your weekly plan, record each week and see the scores your teacher approves.",
    icon: "student",
    action: "Open student dashboard",
  },
  {
    href: "/faculty",
    title: "Faculty Dashboard",
    body: "Review AI-suggested evaluations, check each student's quiz result and set the official marks.",
    icon: "faculty",
    action: "Open faculty dashboard",
  },
];

export default function Home() {
  return (
    <div className="space-y-8">
      <section className="card-hero p-8 sm:p-10">
        <p className="eyebrow">Human–AI co-learning</p>
        <h1 className="mt-2 text-4xl font-bold tracking-tight sm:text-5xl">Human–AI Co-Learning Agent</h1>
        <p className="mt-4 max-w-2xl text-lg text-muted">
          Students push code to GitHub and complete each week. The AI suggests an evaluation from the code changes; the
          teacher&apos;s approved score is the official result.
        </p>
      </section>
      <section className="grid gap-5 sm:grid-cols-2">
        {cards.map((card) => (
          <Link key={card.href} href={card.href} className="card card-interactive group flex flex-col gap-4 p-6">
            <span className="grid h-11 w-11 place-items-center rounded-xl bg-primary/15 text-accent">
              <Icon name={card.icon} />
            </span>
            <div>
              <h2 className="text-lg font-semibold">{card.title}</h2>
              <p className="mt-1.5 text-sm text-muted">{card.body}</p>
            </div>
            <span className="mt-auto inline-flex items-center gap-2 text-sm font-semibold text-link">
              {card.action}
              <Icon name="arrow" className="h-4 w-4 transition-transform duration-150 group-hover:translate-x-1" />
            </span>
          </Link>
        ))}
      </section>
    </div>
  );
}
