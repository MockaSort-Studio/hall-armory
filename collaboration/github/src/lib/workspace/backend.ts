import * as nodeFs from "node:fs";
import { AsyncLocalStorage } from "node:async_hooks";

// Where the workspace Git operations act. A suite host injects it, exactly as it injects a command
// transport: the package has no knowledge of the host. Without injection the suite works on the process's
// own filesystem at /workspace, which is what a guest-side runner sees.
export type WorkspaceBackend = {
  // Anything with the promise-style `fs` methods isomorphic-git needs (node:fs qualifies).
  fs: any;
  // The working-tree root inside that filesystem.
  dir: string;
  // Credentials for pushing; only GITHUB_TOKEN is read.
  env?: Record<string, string | undefined>;
  git?: any;
  http?: any;
};

const scope = new AsyncLocalStorage<WorkspaceBackend>();

export const defaultBackend = (): WorkspaceBackend => ({
  fs: nodeFs,
  dir: "/workspace",
  env: process.env,
});

export const currentBackend = (): WorkspaceBackend =>
  scope.getStore() ?? defaultBackend();

export function withWorkspaceBackend<T>(
  backend: WorkspaceBackend | undefined,
  action: () => T,
): T {
  return backend ? scope.run(backend, action) : action();
}
