import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { Icon, PageHeader, ProgressBar, ScoreCard, StatCard, WeekScoreBars } from "./ui";

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
  it("shows each week's real score, and a dash with a spoken explanation where there is none", () => {
    render(
      <WeekScoreBars
        weeks={[
          { weekNumber: 1, score: 80 },
          { weekNumber: 2, score: null, note: "Waiting for review" },
          { weekNumber: 3, score: 0 },
        ]}
      />,
    );
    const bars = screen.getByRole("group", { name: "Official result by week" });
    expect(bars).toHaveTextContent("W1: 80 out of 100");
    expect(bars).toHaveTextContent("W2 has no official result (Waiting for review)");
    expect(bars).toHaveTextContent("W3: 0 out of 100"); // zero is a real score
    expect(within(bars).getByText("–")).toBeInTheDocument();
  });

  it("scales each bar to its score, and never beyond the track", () => {
    const { container } = render(<WeekScoreBars weeks={[{ weekNumber: 1, score: 50 }, { weekNumber: 2, score: 140 }]} />);
    const heights = [...container.querySelectorAll<HTMLElement>("[style*='height']")].map((el) => el.style.height);
    expect(heights).toEqual(["50%", "100%"]);
  });

  it("is not a list, so it does not add list items to the page", () => {
    render(<WeekScoreBars weeks={[{ weekNumber: 1, score: 10 }]} />);
    expect(screen.queryByRole("listitem")).not.toBeInTheDocument();
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
