import { ApiError } from "@google/genai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GitHubError } from "@/lib/github/errors";
import { GeminiError } from "./errors";
import { toGeminiError } from "./shared";

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("toGeminiError", () => {
  it("tells a per-minute limit from a daily quota, because only one clears soon", () => {
    const perMinute = new ApiError({ message: "Quota exceeded for metric ... PerMinutePerProjectPerModel", status: 429 });
    const perDay = new ApiError({
      message: "Quota exceeded ... GenerateRequestsPerDayPerProjectPerModel-FreeTier. Generate content requests per day limit exceeded.",
      status: 429,
    });
    expect(toGeminiError(perMinute).code).toBe("rate_limited");
    expect(toGeminiError(perMinute).message).toMatch(/wait a minute/);
    expect(toGeminiError(perDay).code).toBe("quota_exhausted");
    expect(toGeminiError(perDay).message).toMatch(/tomorrow/);
    expect(toGeminiError(perDay).message).not.toMatch(/wait a minute/);
  });

  it.each([
    [408, "timeout"],
    [504, "timeout"],
    [500, "unavailable"],
    [503, "unavailable"],
    [400, "rejected"],
    [401, "rejected"],
    [403, "rejected"],
  ])("maps HTTP %i to %s", (status, code) => {
    expect(toGeminiError(new ApiError({ message: "x", status })).code).toBe(code);
  });

  it("maps network aborts and unknown failures without leaking details", () => {
    expect(toGeminiError(Object.assign(new Error("The operation was aborted"), { name: "AbortError" })).code).toBe("timeout");
    const unknown = toGeminiError(new Error("socket hang up sk-secret-key-123"));
    expect(unknown.code).toBe("unavailable");
    expect(unknown.message).not.toMatch(/sk-secret|socket/);
  });

  it("passes an existing GeminiError through, and its invalid-response message is not about plans only", () => {
    const original = new GeminiError("invalid_response");
    expect(toGeminiError(original)).toBe(original);
    expect(original.message).not.toMatch(/plan/);
  });
});

describe("GitHubError rate limit message", () => {
  it("shows the reset time as a readable UTC clock time, not an ISO timestamp", () => {
    const error = new GitHubError("rate_limited", { resetAt: "2026-10-25T20:58:36.000Z" });
    expect(error.message).toContain("It resets at 20:58 UTC.");
    expect(error.message).not.toMatch(/T20:58/);
  });

  it("still works without a reset time", () => {
    expect(new GitHubError("rate_limited").message).toBe("GitHub's rate limit was reached. Please try again later.");
  });
});
