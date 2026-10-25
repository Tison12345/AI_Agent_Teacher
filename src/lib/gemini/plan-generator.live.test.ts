// Live test against the real Gemini API. Skipped unless GEMINI_API_KEY is set.
// Costs one real API call. Run with: npx vitest run plan-generator.live
import { describe, expect, it } from "vitest";
import { getGeminiClient, getGeminiModel } from "./client";
import { generateWeeklyPlan } from "./plan-generator";

describe.skipIf(!process.env.GEMINI_API_KEY)("generateWeeklyPlan (live Gemini)", () => {
  it("returns a schema-valid 12-week plan", async () => {
    const plan = await generateWeeklyPlan(
      {
        title: "Smart Attendance System",
        description:
          "A web app that marks class attendance using face recognition from a webcam, with a teacher dashboard for reports.",
      },
      { client: getGeminiClient(), model: getGeminiModel() },
    );
    expect(plan).toHaveLength(12);
    // The student's repository already exists, so no week may ask to create it.
    const week1Text = JSON.stringify(plan[0].tasks.concat(plan[0].deliverables));
    expect(week1Text).not.toMatch(/(create|set up|initialize|init)\b[^."]{0,40}\b(github )?repositor/i);
    for (const week of plan) {
      expect(week.evaluationCriteria.reduce((s, c) => s + c.maxPoints, 0)).toBe(100);
    }
  }, 120_000);
});
