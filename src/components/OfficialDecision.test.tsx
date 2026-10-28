import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { OfficialDecision, type DecisionStatus } from "./OfficialDecision";

const card = () => screen.getByRole("region", { name: "Official faculty decision" });

describe("OfficialDecision", () => {
  it("approved: indigo card, an Approved badge, the large score, the feedback and the time", () => {
    render(
      <OfficialDecision status="approved" score={100} feedback="Great work." decidedAt="2026-10-27T10:05:00+00:00" />,
    );
    expect(card()).toHaveClass("card-official");
    expect(card()).not.toHaveClass("alert-success");
    expect(card()).toHaveTextContent("Approved");
    expect(screen.getByText("Approved")).toHaveClass("badge-official");
    expect(screen.getByLabelText("Official score 100 out of 100")).toHaveTextContent("100/100");
    expect(screen.getByText("Faculty feedback")).toBeInTheDocument();
    expect(card()).toHaveTextContent("Great work.");
    expect(card()).toHaveTextContent("Decided");
  });

  it("edited: says Edited, with the teacher's own score", () => {
    render(<OfficialDecision status="edited" score={64.5} feedback="Fix the tests." note="The AI suggested 90." />);
    expect(card()).toHaveTextContent("Edited by faculty");
    expect(screen.getByLabelText("Official score 64.5 out of 100")).toBeInTheDocument();
    expect(card()).toHaveTextContent("The AI suggested 90.");
    expect(card()).not.toHaveTextContent("Approved");
  });

  it("rejected: a danger badge, no score, and it is not presented as approved", () => {
    render(<OfficialDecision status="rejected" score={null} />);
    expect(screen.getByText("Rejected")).toHaveClass("badge-danger");
    expect(card()).toHaveTextContent("No official score was given for this week.");
    expect(card()).not.toHaveTextContent("Approved");
    expect(card().textContent).not.toMatch(/\d+\s*\/\s*100/);
  });

  it("pending: a waiting badge and no score", () => {
    render(<OfficialDecision status="pending_review" score={null} />);
    expect(screen.getByText("Waiting for review")).toHaveClass("badge-warning");
    expect(card()).toHaveTextContent("No official score yet.");
    expect(card()).not.toHaveTextContent("Decided");
  });

  it("a score of zero is shown", () => {
    render(<OfficialDecision status="approved" score={0} />);
    expect(screen.getByLabelText("Official score 0 out of 100")).toBeInTheDocument();
  });

  it("extra sections, such as a private comment, are shown inside the card", () => {
    render(
      <OfficialDecision status="approved" score={80}>
        <p>Private note</p>
      </OfficialDecision>,
    );
    expect(card()).toHaveTextContent("Private note");
  });

  it("several cards on one page each have their own heading id", () => {
    const statuses: DecisionStatus[] = ["approved", "rejected"];
    render(
      <>
        {statuses.map((s) => (
          <OfficialDecision key={s} status={s} score={null} />
        ))}
      </>,
    );
    const ids = screen.getAllByRole("heading", { name: "Official faculty decision" }).map((h) => h.id);
    expect(new Set(ids).size).toBe(2);
    expect(screen.getAllByRole("region", { name: "Official faculty decision" })).toHaveLength(2);
  });
});
