import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { StoredPlan } from "@/lib/schemas/weekly-plan";

const api = vi.hoisted(() => ({ fetchPlan: vi.fn(), generatePlan: vi.fn() }));
vi.mock("@/lib/api/client", () => api);

import { PlanSection } from "./PlanSection";

const id = "123e4567-e89b-42d3-a456-426614174000";
const plan: StoredPlan = {
  projectId: id,
  model: "test-model",
  generatedAt: "2026-10-26T10:00:00+00:00",
  plan: Array.from({ length: 12 }, (_, i) => ({
    weekNumber: i + 1,
    title: `Title ${i + 1}`,
    objectives: ["Learn"],
    tasks: ["Build"],
    deliverables: ["Code"],
    evaluationCriteria: [
      { name: "Works", description: "It runs", maxPoints: 60 },
      { name: "Quality", description: "Clean", maxPoints: 40 },
    ],
  })),
};

beforeEach(() => vi.clearAllMocks());

describe("PlanSection", () => {
  it("shows loading, then the empty state with a generate button", async () => {
    api.fetchPlan.mockResolvedValue(null);
    render(<PlanSection projectId={id} />);
    expect(screen.getByText("Loading plan…")).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Generate plan" })).toBeInTheDocument();
  });

  it("renders all 12 weeks of an existing plan", async () => {
    api.fetchPlan.mockResolvedValue(plan);
    render(<PlanSection projectId={id} />);
    expect(await screen.findByText("Week 12: Title 12")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem").length).toBeGreaterThanOrEqual(12);
    expect(screen.queryByRole("button", { name: "Generate plan" })).not.toBeInTheDocument();
  });

  it("shows a generating state, then the plan", async () => {
    api.fetchPlan.mockResolvedValue(null);
    let resolve: (p: StoredPlan) => void = () => {};
    api.generatePlan.mockReturnValue(new Promise<StoredPlan>((r) => (resolve = r)));
    const user = userEvent.setup();
    render(<PlanSection projectId={id} />);
    await user.click(await screen.findByRole("button", { name: "Generate plan" }));
    expect(screen.getByRole("status")).toHaveTextContent(/Generating your plan/);
    expect(screen.queryByRole("button", { name: "Generate plan" })).not.toBeInTheDocument();
    resolve(plan);
    expect(await screen.findByText("Week 1: Title 1")).toBeInTheDocument();
    expect(api.generatePlan).toHaveBeenCalledTimes(1);
  });

  it("shows the error and allows a retry when generation fails", async () => {
    api.fetchPlan.mockResolvedValue(null);
    api.generatePlan
      .mockRejectedValueOnce(new Error("Gemini is rate limiting requests."))
      .mockResolvedValueOnce(plan);
    const user = userEvent.setup();
    render(<PlanSection projectId={id} />);
    await user.click(await screen.findByRole("button", { name: "Generate plan" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Gemini is rate limiting requests.");
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Week 1: Title 1")).toBeInTheDocument();
  });

  it("shows a load error with retry", async () => {
    api.fetchPlan.mockRejectedValueOnce(new Error("Storage is not configured.")).mockResolvedValueOnce(plan);
    const user = userEvent.setup();
    render(<PlanSection projectId={id} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Storage is not configured.");
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Week 1: Title 1")).toBeInTheDocument();
  });
});
