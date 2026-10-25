import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const api = vi.hoisted(() => ({ fetchResults: vi.fn() }));
vi.mock("@/lib/api/client", () => api);

import { ProjectResults } from "./ProjectResults";

const result = (weekNumber: number, over: object = {}) => ({
  weekNumber,
  outcome: "approved",
  officialScore: 80,
  feedback: "x",
  decidedAt: "2026-10-26T12:00:00+00:00",
  ...over,
});

beforeEach(() => vi.clearAllMocks());

describe("ProjectResults (student dashboard)", () => {
  it("shows each decided week's official score", async () => {
    api.fetchResults.mockResolvedValue([result(1), result(2, { outcome: "edited", officialScore: 40 })]);
    render(<ProjectResults projectId="p1" />);
    expect(await screen.findByText("Teacher-approved results")).toBeInTheDocument();
    expect(screen.getByText("Week 1: 80/100")).toBeInTheDocument();
    expect(screen.getByText("Week 2: 40/100")).toBeInTheDocument();
    expect(api.fetchResults).toHaveBeenCalledWith("p1");
  });

  it("says 'reviewed, no mark' for a rejected week and never invents a score", async () => {
    api.fetchResults.mockResolvedValue([result(3, { outcome: "rejected", officialScore: null, feedback: null })]);
    const { container } = render(<ProjectResults projectId="p1" />);
    expect(await screen.findByText("Week 3: reviewed, no mark")).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/\d+\/100/);
  });

  it("shows nothing while no week has been decided", async () => {
    api.fetchResults.mockResolvedValue([]);
    const { container } = render(<ProjectResults projectId="p1" />);
    await vi.waitFor(() => expect(api.fetchResults).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it("says so when the results cannot be loaded", async () => {
    api.fetchResults.mockRejectedValue(new Error("network"));
    render(<ProjectResults projectId="p1" />);
    expect(await screen.findByText("Teacher results could not be loaded.")).toBeInTheDocument();
  });
});
