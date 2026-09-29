import { execFileSync } from "node:child_process";
import { AsyncLocalStorage } from "node:async_hooks";

export type GithubCommandTransport = {
  run(args: string[], options: Record<string, unknown>): string | Promise<string>;
};

type GithubDependencies = {
  transport?: GithubCommandTransport;
  execFileSync?: typeof execFileSync;
};

const transportScope = new AsyncLocalStorage<GithubCommandTransport>();
const hostTransport: GithubCommandTransport = {
  run(args, options) {
    return execFileSync("gh", args, { encoding: "utf8", ...options });
  },
};

export function withGithubCommandTransport<T>(transport: GithubCommandTransport | undefined, action: () => T): T {
  return transport ? transportScope.run(transport, action) : action();
}

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

// Direct package installation defaults to host `gh`. A suite host can inject
// any command transport; the package has no knowledge of that host.
export async function gh(args, opts = {}, deps: GithubDependencies = {}) {
  const { operation, resource } = context(args, opts);
  const { operation: _operation, resource: _resource, ...execOpts } = opts;
  try {
    const transport = deps.transport ?? transportScope.getStore() ?? (deps.execFileSync
      ? { run: (argv, options) => deps.execFileSync("gh", argv, { encoding: "utf8", ...options }) }
      : hostTransport);
    return (await transport.run(args, execOpts)).trim();
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
