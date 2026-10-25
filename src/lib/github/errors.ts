export type GitHubErrorCode =
  | "invalid_repository"
  | "not_found"
  | "bad_credentials"
  | "forbidden"
  | "rate_limited"
  | "blocked"
  | "empty_repository"
  | "invalid_ref"
  | "timeout"
  | "unavailable"
  | "invalid_response";

/** Safe-to-show messages; raw upstream bodies and tokens are never included. */
const MESSAGES: Record<GitHubErrorCode, string> = {
  invalid_repository: "That is not a valid GitHub repository.",
  not_found: "Repository not found, or it is private and the server cannot access it.",
  bad_credentials: "GitHub rejected the server's access token. The token may be expired or invalid.",
  forbidden:
    "GitHub denied access. The token may lack permission for this repository, or the organization restricts access.",
  rate_limited: "GitHub's rate limit was reached. Please try again later.",
  blocked: "GitHub has blocked access to this repository for legal reasons.",
  empty_repository: "The repository has no commits yet.",
  invalid_ref: "One of the commits was not found in this repository.",
  timeout: "GitHub took too long to respond. Please try again.",
  unavailable: "GitHub is temporarily unavailable. Please try again.",
  invalid_response: "GitHub returned data in an unexpected format.",
};

export class GitHubError extends Error {
  constructor(
    readonly code: GitHubErrorCode,
    readonly options: { resetAt?: string; hadToken?: boolean } = {},
  ) {
    super(buildMessage(code, options));
    this.name = "GitHubError";
  }
}

function buildMessage(
  code: GitHubErrorCode,
  options: { resetAt?: string; hadToken?: boolean },
): string {
  if (code === "not_found") {
    return options.hadToken
      ? "Repository not found, or the server's GitHub token cannot access it."
      : "Repository not found. If it is private, ask your teacher to configure repository access.";
  }
  if (code === "rate_limited" && options.resetAt) {
    return `${MESSAGES.rate_limited} It resets at ${options.resetAt}.`;
  }
  return MESSAGES[code];
}
