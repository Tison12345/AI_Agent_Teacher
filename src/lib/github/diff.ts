import type { CompareFile } from "./schemas";

export const DIFF_LIMITS = {
  /** Files returned in detail; the rest are only counted. */
  maxFiles: 100,
  /** Characters of patch kept per file before truncating. */
  maxPatchCharsPerFile: 12_000,
  /** Characters of patch kept across all files. */
  maxTotalPatchChars: 120_000,
} as const;

export type DiffLimits = { -readonly [K in keyof typeof DIFF_LIMITS]: number };

export type PatchOmittedReason =
  | "deleted" // contents of a removed file add no useful evidence
  | "ignored" // lock files, build output, dependencies, generated files
  | "binary" // images, archives, fonts, ...
  | "unavailable" // GitHub gave no patch (binary or too large)
  | "budget"; // total size limit reached

export type ChangedFile = {
  path: string;
  previousPath?: string;
  status: string;
  additions: number;
  deletions: number;
  patch?: string;
  patchTruncated: boolean;
  patchOmittedReason?: PatchOmittedReason;
};

export type ProcessedDiff = {
  files: ChangedFile[];
  /** Files GitHub reported (before the maxFiles cut). */
  totalFiles: number;
  /** Line totals over ALL files GitHub reported, including omitted ones. */
  totalAdditions: number;
  totalDeletions: number;
  filesOmitted: number;
  patchChars: number;
  /** True if any patch or file was dropped or cut because of size limits. */
  truncated: boolean;
};

const IGNORED_FILE_NAMES = new Set([
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "bun.lockb",
  "poetry.lock",
  "pipfile.lock",
  "cargo.lock",
  "composer.lock",
  "gemfile.lock",
  "go.sum",
  ".ds_store",
]);

const IGNORED_DIRS = [
  "node_modules/",
  "dist/",
  "build/",
  ".next/",
  "out/",
  "vendor/",
  "__pycache__/",
  ".venv/",
  "venv/",
  "coverage/",
  ".idea/",
  ".vscode/",
];

const IGNORED_SUFFIXES = [".min.js", ".min.css", ".map", ".pyc", ".class", ".log"];

const BINARY_EXTENSIONS = new Set([
  "png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "svgz", "pdf", "zip", "gz", "tar", "7z",
  "rar", "jar", "exe", "dll", "so", "bin", "mp3", "mp4", "mov", "avi", "wav", "ttf", "otf",
  "woff", "woff2", "eot", "psd", "sqlite", "db", "pkl", "h5", "onnx", "pt", "pth", "npy",
]);

function ignoredPath(path: string): boolean {
  const lower = path.toLowerCase();
  const name = lower.slice(lower.lastIndexOf("/") + 1);
  if (IGNORED_FILE_NAMES.has(name)) return true;
  if (IGNORED_SUFFIXES.some((s) => lower.endsWith(s))) return true;
  return IGNORED_DIRS.some((d) => lower.startsWith(d) || lower.includes(`/${d}`));
}

function binaryPath(path: string): boolean {
  const dot = path.lastIndexOf(".");
  return dot !== -1 && BINARY_EXTENSIONS.has(path.slice(dot + 1).toLowerCase());
}

/**
 * Turns GitHub's file list into a bounded, labelled set of changes. Text is only
 * ever read as data; nothing is executed. Every omission is recorded.
 */
export function processDiffFiles(
  files: CompareFile[],
  limits: DiffLimits = { ...DIFF_LIMITS },
): ProcessedDiff {
  const kept = files.slice(0, limits.maxFiles);
  let budget = limits.maxTotalPatchChars;
  let patchChars = 0;
  let truncated = files.length > kept.length;

  const result: ChangedFile[] = kept.map((file) => {
    const base: ChangedFile = {
      path: file.filename,
      previousPath: file.previous_filename,
      status: file.status,
      additions: file.additions,
      deletions: file.deletions,
      patchTruncated: false,
    };

    if (file.status === "removed") return { ...base, patchOmittedReason: "deleted" };
    if (ignoredPath(file.filename)) return { ...base, patchOmittedReason: "ignored" };
    if (binaryPath(file.filename)) return { ...base, patchOmittedReason: "binary" };
    // GitHub omits the patch for binary files and for very large diffs.
    if (!file.patch) {
      return file.changes > 0
        ? { ...base, patchOmittedReason: "unavailable" }
        : base; // e.g. a pure rename or mode change: nothing to show
    }
    if (budget <= 0) {
      truncated = true;
      return { ...base, patchOmittedReason: "budget" };
    }

    const allowed = Math.min(limits.maxPatchCharsPerFile, budget);
    const cut = file.patch.length > allowed;
    const patch = cut ? file.patch.slice(0, allowed) : file.patch;
    if (cut) truncated = true;
    budget -= patch.length;
    patchChars += patch.length;
    return { ...base, patch, patchTruncated: cut };
  });

  return {
    files: result,
    totalFiles: files.length,
    totalAdditions: files.reduce((sum, file) => sum + file.additions, 0),
    totalDeletions: files.reduce((sum, file) => sum + file.deletions, 0),
    filesOmitted: files.length - kept.length,
    patchChars,
    truncated,
  };
}
