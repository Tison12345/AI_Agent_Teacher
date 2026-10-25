import { describe, expect, it } from "vitest";
import { processDiffFiles, type DiffLimits } from "./diff";
import type { CompareFile } from "./schemas";

const file = (over: Partial<CompareFile> = {}): CompareFile => ({
  filename: "src/app.ts",
  status: "modified",
  additions: 3,
  deletions: 1,
  changes: 4,
  patch: "@@ -1 +1 @@\n-a\n+b",
  ...over,
});

const limits = (over: Partial<DiffLimits> = {}): DiffLimits => ({
  maxFiles: 100,
  maxPatchCharsPerFile: 12_000,
  maxTotalPatchChars: 120_000,
  ...over,
});

describe("processDiffFiles", () => {
  it("keeps patches of normal source files", () => {
    const out = processDiffFiles([file()], limits());
    expect(out.files[0]).toMatchObject({ path: "src/app.ts", patch: "@@ -1 +1 @@\n-a\n+b", patchTruncated: false });
    expect(out.files[0].patchOmittedReason).toBeUndefined();
    expect(out).toMatchObject({ totalFiles: 1, filesOmitted: 0, truncated: false });
  });

  it("does not send the contents of deleted files, but keeps their line counts", () => {
    const out = processDiffFiles([file({ filename: "old.ts", status: "removed", additions: 0, deletions: 40 })], limits());
    expect(out.files[0]).toMatchObject({ status: "removed", deletions: 40, patchOmittedReason: "deleted" });
    expect(out.files[0].patch).toBeUndefined();
  });

  it.each([
    "package-lock.json",
    "web/yarn.lock",
    "pnpm-lock.yaml",
    "poetry.lock",
    "node_modules/left-pad/index.js",
    "app/node_modules/x/y.js",
    "dist/bundle.js",
    ".next/server/app.js",
    "static/app.min.js",
    "build/output.txt",
    "__pycache__/mod.pyc",
  ])("ignores generated or dependency file %s", (filename) => {
    const out = processDiffFiles([file({ filename })], limits());
    expect(out.files[0].patchOmittedReason).toBe("ignored");
    expect(out.files[0].patch).toBeUndefined();
  });

  it("does not ignore look-alike names", () => {
    const out = processDiffFiles([file({ filename: "src/distance.ts" }), file({ filename: "src/builder/main.ts" })], limits());
    expect(out.files.every((f) => f.patch !== undefined)).toBe(true);
  });

  it.each(["logo.png", "model.PKL", "assets/font.woff2", "report.pdf", "data.sqlite"])("treats %s as binary", (filename) => {
    const out = processDiffFiles([file({ filename, patch: undefined })], limits());
    expect(out.files[0].patchOmittedReason).toBe("binary");
  });

  it("flags files for which GitHub sent no patch (too large or binary)", () => {
    const out = processDiffFiles([file({ patch: undefined, changes: 5000 })], limits());
    expect(out.files[0].patchOmittedReason).toBe("unavailable");
  });

  it("does not flag a pure rename with no content change", () => {
    const out = processDiffFiles(
      [file({ filename: "new.ts", previous_filename: "old.ts", status: "renamed", patch: undefined, changes: 0, additions: 0, deletions: 0 })],
      limits(),
    );
    expect(out.files[0]).toMatchObject({ path: "new.ts", previousPath: "old.ts", status: "renamed" });
    expect(out.files[0].patchOmittedReason).toBeUndefined();
  });

  it("truncates an oversized patch and says so", () => {
    const out = processDiffFiles([file({ patch: "x".repeat(500) })], limits({ maxPatchCharsPerFile: 100 }));
    expect(out.files[0].patch).toHaveLength(100);
    expect(out.files[0].patchTruncated).toBe(true);
    expect(out.truncated).toBe(true);
    expect(out.patchChars).toBe(100);
  });

  it("stops adding patches once the total budget is used, and records it", () => {
    const files = [1, 2, 3].map((n) => file({ filename: `f${n}.ts`, patch: "y".repeat(60) }));
    const out = processDiffFiles(files, limits({ maxTotalPatchChars: 100 }));
    expect(out.files[0].patch).toHaveLength(60);
    expect(out.files[1].patch).toHaveLength(40); // partly fits
    expect(out.files[1].patchTruncated).toBe(true);
    expect(out.files[2]).toMatchObject({ patchOmittedReason: "budget" });
    expect(out.patchChars).toBe(100);
    expect(out.truncated).toBe(true);
  });

  it("ignored and deleted files do not use up the budget", () => {
    const out = processDiffFiles(
      [file({ filename: "package-lock.json", patch: "z".repeat(1000) }), file({ patch: "q".repeat(50) })],
      limits({ maxTotalPatchChars: 60 }),
    );
    expect(out.files[1].patch).toHaveLength(50);
    expect(out.truncated).toBe(false);
  });

  it("caps the number of detailed files and reports how many were left out", () => {
    const files = Array.from({ length: 7 }, (_, i) => file({ filename: `f${i}.ts` }));
    const out = processDiffFiles(files, limits({ maxFiles: 5 }));
    expect(out).toMatchObject({ totalFiles: 7, filesOmitted: 2, truncated: true });
    expect(out.files).toHaveLength(5);
  });

  it("totals added and deleted lines over every file, including omitted ones", () => {
    const files = Array.from({ length: 7 }, (_, i) => file({ filename: `f${i}.ts`, additions: 10, deletions: 2 }));
    const out = processDiffFiles(files, limits({ maxFiles: 5 }));
    expect(out.files).toHaveLength(5);
    expect(out).toMatchObject({ totalAdditions: 70, totalDeletions: 14 });
  });

  it("returns an empty result for an empty diff", () => {
    expect(processDiffFiles([], limits())).toMatchObject({ files: [], totalFiles: 0, truncated: false, patchChars: 0 });
  });
});
