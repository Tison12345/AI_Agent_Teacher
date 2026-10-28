// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { handleUnexpected } from "./errors";

describe("handleUnexpected", () => {
  it("a missing workflow database is a 503 that says nothing about the connection", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const error = Object.assign(new Error("DATABASE_URL is not set"), { name: "WorkflowConfigError" });
    const res = handleUnexpected(error);
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error.code).toBe("workflow_unavailable");
    expect(JSON.stringify(body)).not.toMatch(/DATABASE_URL|postgres/i);
  });
});
