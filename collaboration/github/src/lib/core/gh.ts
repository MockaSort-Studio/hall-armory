import { execFile, execFileSync } from "node:child_process";
import { AsyncLocalStorage } from "node:async_hooks";

export type GithubCommandTransport = {
  // `options.signal` is set only for cancellable calls; `options.encoding === "buffer"` asks for raw bytes (Buffer or
  // Uint8Array) bounded by `options.maxBuffer`. A transport that returns text there is reported as unable to.
  run(args: string[], options: Record<string, unknown>): string | Uint8Array | Promise<string | Uint8Array>;
};

type GithubDependencies = {
  transport?: GithubCommandTransport;
  execFileSync?: typeof execFileSync;
};

const transportScope = new AsyncLocalStorage<GithubCommandTransport>();
const hostTransport: GithubCommandTransport = {
  run(args, options) {
    // A cancellable call runs asynchronously so the abort signal can stop the child process; every other call keeps
    // the original synchronous behaviour.
    if (options?.signal) return runAsync(args, options);
    return execFileSync("gh", args, { encoding: "utf8", ...options });
  },
};

function runAsync(args: string[], options: Record<string, unknown>) {
  return new Promise<string | Buffer>((resolve, reject) => {
    execFile("gh", args, { encoding: "utf8", ...options } as any, (error, stdout, stderr) =>
      error ? reject(Object.assign(error, { stderr: String(stderr ?? "") })) : resolve(stdout as string | Buffer),
    );
  });
}

// A cancelled call is not a GitHub failure: it carries its own type so callers can tell the two apart.
export class GithubCancelledError extends Error {
  constructor(message = "Cancelled while waiting for GitHub") {
    super(message);
    this.name = "AbortError";
  }
}

// Settle with the transport, or reject as soon as the signal aborts even when the transport ignores it.
export function abortable<T>(work: () => T | Promise<T>, signal: AbortSignal | undefined, message?: string): Promise<T> {
  if (!signal) return Promise.resolve().then(work);
  if (signal.aborted) return Promise.reject(new GithubCancelledError(message));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new GithubCancelledError(message));
    signal.addEventListener("abort", onAbort, { once: true });
    const settle = (fn) => (value) => (signal.removeEventListener("abort", onAbort), fn(value));
    Promise.resolve().then(work).then(settle(resolve), settle(reject));
  });
}

function activeTransport(deps: GithubDependencies): GithubCommandTransport {
  return deps.transport ?? transportScope.getStore() ?? (deps.execFileSync
    ? { run: (argv, options) => deps.execFileSync("gh", argv, { encoding: "utf8", ...options }) }
    : hostTransport);
}

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

// Error text may echo signed download URLs or terminal control sequences: drop query strings and controls.
export function redact(text: string) {
  return String(text)
    .replace(/(https?:\/\/[^\s?#"'<>]+)[?#][^\s"'<>]*/gi, "$1?[redacted]")
    .replace(/\u001b\[[0-9;?]*[A-Za-z]/g, "")
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, " ");
}

// The HTTP status of a failure. `GithubError.status` keeps its contract (an integer `status` wins, which for a
// synchronous `gh` failure is the exit code); this reads only HTTP-like values, falling back to what `gh` printed.
const isHttpStatus = (value) => Number.isInteger(value) && value >= 100 && value <= 599;
export function httpStatusOf(error): number | undefined {
  for (const candidate of [error, error?.cause]) if (isHttpStatus(candidate?.status)) return candidate.status;
  const text = [error?.stderr, error?.message, error?.cause?.stderr, error?.cause?.message].map((part) => String(part ?? "")).join("\n");
  const match = text.match(/\bHTTP\s+(\d{3})\b/i);
  return match ? Number(match[1]) : undefined;
}

export function githubError(error, operation, resource) {
  if (error instanceof GithubError) return error;
  const status = statusOf(error);
  const detail = redact(
    String(error?.stderr ?? "").trim() || error?.message || "unknown GitHub failure",
  );
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
// `signal` is optional: without it the transport receives exactly the options it always did.
export async function gh(args, opts: Record<string, any> = {}, deps: GithubDependencies = {}) {
  const { operation, resource } = context(args, opts);
  const { operation: _operation, resource: _resource, ...execOpts } = opts;
  const signal: AbortSignal | undefined = execOpts.signal;
  if (!signal) delete execOpts.signal;
  try {
    const transport = activeTransport(deps);
    const out = await abortable(() => transport.run(args, execOpts), signal);
    const text = typeof out === "string" ? out : Buffer.from(out).toString("utf8");
    // A transport may ignore `maxBuffer`: the bound is enforced on what it returned as well.
    if (execOpts.maxBuffer !== undefined && Buffer.byteLength(text) > execOpts.maxBuffer) throw new GithubOversizedError(execOpts.maxBuffer);
    return text.trim();
  } catch (error) {
    if (error instanceof GithubCancelledError || error instanceof GithubOversizedError) throw error;
    if (signal?.aborted) throw new GithubCancelledError();
    // Only a caller that set its own bound learns about an overflow as such; other callers see the same error as before.
    if (execOpts.maxBuffer !== undefined && isBufferOverflow(error)) throw new GithubOversizedError(execOpts.maxBuffer);
    throw githubError(error, operation, resource);
  }
}

export class GithubOversizedError extends Error {
  limit: number;
  constructor(limit: number) {
    super(`GitHub response exceeds ${limit} bytes`);
    this.limit = limit;
    this.name = "GithubOversizedError";
  }
}

const isBufferOverflow = (error) =>
  error?.code === "ENOBUFS" || error?.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" || /maxBuffer/i.test(String(error?.message ?? ""));

// A bounded binary response. The transport is asked for `encoding: "buffer"` with a `maxBuffer` limit; a transport
// that can only return text is reported as unable to, never decoded as if it were bytes.
export async function ghBytes(args: string[], { maxBytes, signal, operation, resource }: { maxBytes: number; signal?: AbortSignal; operation?: string; resource?: string }, deps: GithubDependencies = {}) {
  const where = context(args, { operation, resource });
  const options: Record<string, unknown> = { encoding: "buffer", maxBuffer: maxBytes };
  if (signal) options.signal = signal;
  let out;
  try {
    const transport = activeTransport(deps);
    out = await abortable(() => transport.run(args, options), signal);
  } catch (error) {
    if (error instanceof GithubCancelledError) throw error;
    if (signal?.aborted) throw new GithubCancelledError();
    if (isBufferOverflow(error)) throw new GithubOversizedError(maxBytes);
    throw githubError(error, where.operation, where.resource);
  }
  if (!(out instanceof Uint8Array)) throw new GithubError(`GitHub ${where.operation} failed for ${where.resource}: the command transport cannot return binary responses`, { operation: where.operation, resource: where.resource });
  if (out.byteLength > maxBytes) throw new GithubOversizedError(maxBytes);
  return out;
}

export async function ghJson(args, opts: Record<string, any> = {}, deps?: GithubDependencies) {
  const { operation, resource } = context(args, opts);
  const out = await gh(args, opts, deps);
  if (!out) return null;
  try {
    return JSON.parse(out);
  } catch (error) {
    throw githubError(error, operation, resource);
  }
}
