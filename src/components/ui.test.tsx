import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Disclosure, Icon, PageHeader, ProgressBar, ScoreCard, StatCard, WeekScoreBars } from "./ui";

describe("ProgressBar", () => {
  it.each([
    [0, "0"],
    [42.4, "42"],
    [99.6, "100"],
    [150, "100"],
    [-20, "0"],
  ])("shows %d as %s%%, clamped to 0-100", (percent, expected) => {
    render(<ProgressBar percent={percent} label="Done" />);
    const bar = screen.getByRole("progressbar", { name: "Done" });
    expect(bar).toHaveAttribute("aria-valuenow", expected);
    expect(bar).toHaveAttribute("aria-valuemin", "0");
    expect(bar).toHaveAttribute("aria-valuemax", "100");
    expect(bar.firstElementChild).toHaveStyle({ width: `${expected}%` });
  });
});

describe("ScoreCard", () => {
  it("shows the score large, the maximum, a caption and a progress bar for the same fraction", () => {
    render(<ScoreCard label="Average" score={72.5} caption="Across two weeks" />);
    const card = screen.getByRole("region", { name: "Average" });
    expect(within(card).getByLabelText("Average: 72.5 out of 100")).toHaveTextContent("72.5/ 100");
    expect(card).toHaveTextContent("Across two weeks");
    expect(within(card).getByRole("progressbar")).toHaveAttribute("aria-valuenow", "73");
  });

  it("uses the given maximum", () => {
    render(<ScoreCard label="Quiz" score={3} max={5} />);
    expect(screen.getByLabelText("Quiz: 3 out of 5")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "60");
  });

  it("with no score it says why, and shows no number and no progress bar", () => {
    render(<ScoreCard label="Average" score={null} empty="No reviewed weeks yet" />);
    const card = screen.getByRole("region", { name: "Average" });
    expect(card).toHaveTextContent("No reviewed weeks yet");
    expect(card.textContent).not.toMatch(/\d/);
    expect(within(card).queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("a score of zero is shown, not treated as missing", () => {
    render(<ScoreCard label="Average" score={0} />);
    expect(screen.getByLabelText("Average: 0 out of 100")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "0");
  });

  it("the hero version is larger than the normal one, and extra content is shown inside", () => {
    const { rerender } = render(<ScoreCard label="Main" score={50} hero><p>extra</p></ScoreCard>);
    const hero = screen.getByRole("region", { name: "Main" });
    expect(hero).toHaveClass("card-hero");
    expect(hero).toHaveTextContent("extra");
    expect(within(hero).getByText("50")).toHaveClass("text-6xl");
    rerender(<ScoreCard label="Main" score={50} />);
    expect(screen.getByRole("region", { name: "Main" })).not.toHaveClass("card-hero");
    expect(screen.getByText("50")).toHaveClass("text-5xl");
  });
});

describe("WeekScoreBars", () => {
  it("shows each week's real score, and the reason in words where there is none", () => {
    render(
      <WeekScoreBars
        weeks={[
          { weekNumber: 1, score: 80 },
          { weekNumber: 2, score: null, note: "Awaiting review" },
          { weekNumber: 3, score: 0 },
          { weekNumber: 4, score: null, note: "Not recorded" },
        ]}
      />,
    );
    const bars = screen.getByRole("group", { name: "Official result by week" });
    expect(bars).toHaveTextContent("W1: 80 out of 100");
    expect(bars).toHaveTextContent("W2 has no official result (Awaiting review)");
    expect(bars).toHaveTextContent("W3: 0 out of 100"); // zero is a real score
    expect(bars).toHaveTextContent("W4 has no official result (Not recorded)");
    expect(within(bars).getByText("Awaiting review", { selector: "span[aria-hidden]" })).toBeInTheDocument();
    expect(within(bars).getByText("Not recorded", { selector: "span[aria-hidden]" })).toBeInTheDocument();
  });

  it("draws horizontal bars scaled to a 0-100 axis, never taller than a thin track", () => {
    const { container } = render(<WeekScoreBars weeks={[{ weekNumber: 1, score: 50 }, { weekNumber: 2, score: 140 }]} />);
    const widths = [...container.querySelectorAll<HTMLElement>("[style*='width']")].map((el) => el.style.width);
    expect(widths).toEqual(["50%", "100%"]);
    expect(container.querySelector("[style*='height']")).toBeNull(); // no tall, stretched block
    const axis = [...container.querySelectorAll(".justify-between > span")].map((s) => s.textContent).filter((t) => /^\d+$/.test(t ?? ""));
    expect(axis).toEqual(["0", "25", "50", "75", "100"]);
  });

  it("looks balanced with a single recorded week: one row with its label, bar and value", () => {
    const { container } = render(<WeekScoreBars weeks={[{ weekNumber: 1, score: 100 }]} />);
    expect(container.querySelectorAll("[style*='width']")).toHaveLength(1);
    expect(screen.getByRole("group")).toHaveTextContent("W1: 100 out of 100");
  });

  it("a zero is a marker on the zero line, not an empty dashed track like an unrecorded week", () => {
    const { container } = render(
      <WeekScoreBars weeks={[{ weekNumber: 1, score: 0 }, { weekNumber: 2, score: null, note: "Not recorded" }]} />,
    );
    const tracks = container.querySelectorAll("div[aria-hidden='true'].relative");
    expect(tracks).toHaveLength(2);
    expect(tracks[0]).not.toHaveClass("border-dashed");
    expect(tracks[0].querySelector(".bg-accent")).not.toBeNull(); // the zero marker
    expect(tracks[1]).toHaveClass("border-dashed");
    expect(tracks[1].children).toHaveLength(0);
  });

  it("is not a list, and no loading animation is used for a score", () => {
    const { container } = render(<WeekScoreBars weeks={[{ weekNumber: 1, score: 10 }]} />);
    expect(screen.queryByRole("listitem")).not.toBeInTheDocument();
    expect(container.querySelector("[class*='animate-']")).toBeNull();
  });
});

describe("Disclosure", () => {
  it("is collapsed by default, with its summary visible and its details hidden", () => {
    render(
      <Disclosure summary={<span>Week 1 quiz · 1/5 correct</span>}>
        <p>Details</p>
      </Disclosure>,
    );
    const button = screen.getByRole("button", { name: /Week 1 quiz · 1\/5 correct/ });
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText("Details")).not.toBeVisible();
    expect(button).toHaveAttribute("aria-controls", screen.getByText("Details").parentElement!.id);
  });

  it("opens and closes on click, and the chevron rotates when open", async () => {
    const user = userEvent.setup();
    render(
      <Disclosure summary="Summary">
        <p>Details</p>
      </Disclosure>,
    );
    const button = screen.getByRole("button", { name: "Summary" });
    const chevron = button.querySelector("svg")!;
    expect(chevron).not.toHaveClass("rotate-180");
    await user.click(button);
    expect(screen.getByText("Details")).toBeVisible();
    expect(chevron).toHaveClass("rotate-180");
    await user.click(button);
    expect(screen.getByText("Details")).not.toBeVisible();
  });

  it("works from the keyboard with Enter and Space", async () => {
    const user = userEvent.setup();
    render(
      <Disclosure summary="Summary">
        <p>Details</p>
      </Disclosure>,
    );
    await user.tab();
    await user.keyboard("{Enter}");
    expect(screen.getByText("Details")).toBeVisible();
    await user.keyboard(" ");
    expect(screen.getByText("Details")).not.toBeVisible();
  });

  it("can start open", () => {
    render(
      <Disclosure summary="Summary" defaultOpen>
        <p>Details</p>
      </Disclosure>,
    );
    expect(screen.getByText("Details")).toBeVisible();
  });
});

describe("the small shared pieces", () => {
  it("StatCard shows its label, value and hint", () => {
    render(<StatCard label="Projects" value={3} hint="with an evaluation" />);
    expect(screen.getByText("Projects")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("with an evaluation")).toBeInTheDocument();
  });

  it("PageHeader has one level-1 heading, with optional description and actions", () => {
    render(<PageHeader eyebrow="Faculty" title="Faculty Dashboard" description="Review work." actions={<button>Go</button>} />);
    expect(screen.getByRole("heading", { level: 1, name: "Faculty Dashboard" })).toBeInTheDocument();
    expect(screen.getByText("Review work.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Go" })).toBeInTheDocument();
  });

  it("icons are hidden from screen readers", () => {
    const { container } = render(<Icon name="check" />);
    expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });
});
