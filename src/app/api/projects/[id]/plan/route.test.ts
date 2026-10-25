import { beforeEach, describe, expect, it, vi } from "vitest";
import { GeminiError } from "@/lib/gemini/errors";

const mocks = vi.hoisted(() => ({
  getProject: vi.fn(),
  getPlan: vi.fn(),
  savePlan: vi.fn(),
  generateWeeklyPlan: vi.fn(),
  getGeminiClient: vi.fn(),
}));

vi.mock("@/lib/projects/repository", () => ({
  getProject: mocks.getProject,
  RepositoryError: class RepositoryError extends Error {
    constructor(readonly code: string, message: string) {
      super(message);
    }
  },
}));
vi.mock("@/lib/plans/repository", () => ({ getPlan: mocks.getPlan, savePlan: mocks.savePlan }));
vi.mock("@/lib/gemini/plan-generator", () => ({ generateWeeklyPlan: mocks.generateWeeklyPlan }));
vi.mock("@/lib/gemini/client", () => ({
  getGeminiClient: mocks.getGeminiClient,
  getGeminiModel: () => "test-model",
}));
vi.mock("@/lib/db/supabase", () => ({ StorageConfigError: class extends Error {} }));

import { RepositoryError } from "@/lib/projects/repository";
import { GET, POST } from "./route";

const id = "123e4567-e89b-42d3-a456-426614174000";
const project = { id, title: "Smart Attendance", description: "A system that marks attendance." };
const stored = { projectId: id, plan: [], model: "test-model", generatedAt: "2026-10-26T10:00:00+00:00" };
const ctx = (value: string) => ({ params: Promise.resolve({ id: value }) }) as never;
const req = new Request("http://localhost/api/projects/x/plan", { method: "POST" });

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.getProject.mockResolvedValue(project);
  mocks.getPlan.mockResolvedValue(null);
  mocks.getGeminiClient.mockReturnValue({});
  mocks.generateWeeklyPlan.mockResolvedValue([]);
  mocks.savePlan.mockResolvedValue(stored);
});

describe("POST /api/projects/[id]/plan", () => {
  it("generates, saves and returns the plan", async () => {
    const res = await POST(req, ctx(id));
    expect(res.status).toBe(201);
    expect(mocks.savePlan).toHaveBeenCalledWith(id, [], "test-model");
    expect((await res.json()).plan.model).toBe("test-model");
  });

  it("rejects a non-UUID id and unknown project", async () => {
    expect((await POST(req, ctx("nope"))).status).toBe(400);
    mocks.getProject.mockResolvedValue(null);
    expect((await POST(req, ctx(id))).status).toBe(404);
    expect(mocks.generateWeeklyPlan).not.toHaveBeenCalled();
  });

  it("returns 409 without calling Gemini when a plan already exists", async () => {
    mocks.getPlan.mockResolvedValue(stored);
    expect((await POST(req, ctx(id))).status).toBe(409);
    expect(mocks.generateWeeklyPlan).not.toHaveBeenCalled();
  });

  it("returns 409 if a concurrent request saved first", async () => {
    mocks.savePlan.mockRejectedValue(new RepositoryError("conflict", "dup"));
    expect((await POST(req, ctx(id))).status).toBe(409);
  });

  it("returns 503 before any API call when the Gemini key is missing", async () => {
    mocks.getGeminiClient.mockImplementation(() => {
      throw new GeminiError("not_configured");
    });
    const res = await POST(req, ctx(id));
    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe("gemini_not_configured");
    expect(mocks.generateWeeklyPlan).not.toHaveBeenCalled();
  });

  it.each([
    ["rate_limited", 429],
    ["invalid_response", 502],
    ["timeout", 504],
  ] as const)("maps Gemini %s to HTTP %i and saves nothing", async (code, status) => {
    mocks.generateWeeklyPlan.mockRejectedValue(new GeminiError(code));
    expect((await POST(req, ctx(id))).status).toBe(status);
    expect(mocks.savePlan).not.toHaveBeenCalled();
  });
});

describe("GET /api/projects/[id]/plan", () => {
  const get = new Request("http://localhost/x");
  it("returns null before generation and the plan afterwards", async () => {
    expect(await (await GET(get, ctx(id))).json()).toEqual({ plan: null });
    mocks.getPlan.mockResolvedValue(stored);
    expect((await (await GET(get, ctx(id))).json()).plan.model).toBe("test-model");
  });

  it("returns 404 for an unknown project", async () => {
    mocks.getProject.mockResolvedValue(null);
    expect((await GET(get, ctx(id))).status).toBe(404);
  });
});
