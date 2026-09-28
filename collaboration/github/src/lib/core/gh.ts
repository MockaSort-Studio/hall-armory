import { execFileSync } from "node:child_process";

export class GithubError extends Error {
  constructor(message, { cause, status, operation, resource } = {}) {
    super(message, { cause });
    this.name = "GithubError";
    this.status = status;
    this.operation = operation;
    this.resource = resource;
    this.transient =
      status === 408 || status === 425 || status === 429 || status >= 500;
  }
}

function statusOf(error) {
  if (Number.isInteger(error?.status)) return error.status;
  const match = `${error?.stderr ?? ""}\n${error?.message ?? ""}`.match(
    /\bHTTP\s+(\d{3})\b|\bstatus(?:Code)?[=: ]+(\d{3})\b/i,
  );
  return match ? Number(match[1] ?? match[2]) : undefined;
}

export function githubError(error, operation, resource) {
  if (error instanceof GithubError) return error;
  const status = statusOf(error);
  const detail =
    error?.stderr?.trim() || error?.message || "unknown GitHub failure";
  return new GithubError(
    `GitHub ${operation} failed for ${resource}${status ? ` (HTTP ${status})` : ""}: ${detail}`,
    {
      cause: error,
      status,
      operation,
      resource,
    },
  );
}

function context(args, opts) {
  const operation =
    opts.operation ?? `${args[0] ?? "GitHub"} ${args[1] ?? "operation"}`;
  const resource =
    opts.resource ??
    args.find(
      (arg) => typeof arg === "string" && /^(?:[^/]+\/[^/]+|\d+)$/.test(arg),
    ) ??
    "GitHub resource";
  return { operation, resource };
}

// The extension executes GitHub operations through the authenticated `gh` CLI.
export async function gh(args, opts = {}, deps = { execFileSync }) {
  const { operation, resource } = context(args, opts);
  const { operation: _operation, resource: _resource, ...execOpts } = opts;
  try {
    return deps
      .execFileSync("gh", args, { encoding: "utf8", ...execOpts })
      .trim();
  } catch (error) {
    throw githubError(error, operation, resource);
  }
}

export async function ghJson(args, opts = {}, deps) {
  const { operation, resource } = context(args, opts);
  const out = await gh(args, opts, deps);
  if (!out) return null;
  try {
    return JSON.parse(out);
  } catch (error) {
    throw githubError(error, operation, resource);
  }
}
