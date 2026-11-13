// The npm suite's operations, registered through one schema path.
import { Type } from "typebox";
import { auditLockfile } from "./audit.ts";
import { installVerified } from "./install.ts";
import { registerOperations, type OperationDescriptor } from "./registration.ts";
import { defaultWorkspace, type NpmWorkspace } from "./workspace.ts";
import type { FetchLike } from "./registry.ts";

const Include = Type.Optional(Type.Union([Type.Literal("all"), Type.Literal("production")]));
const Path = (description: string) => Type.Optional(Type.String({ minLength: 1, maxLength: 1024, description }));

export function npmOperationDescriptors({
  workspace,
  fetch = globalThis.fetch,
}: { workspace?: NpmWorkspace; fetch?: FetchLike } = {}): OperationDescriptor[] {
  const where = () => workspace ?? defaultWorkspace();
  return [
    {
      name: "npm_install_verified",
      description:
        "Install a project's dependency tree exactly as its package-lock.json (v2/v3) locks it: each tarball is fetched from registry.npmjs.org, checked against the lockfile's sha512 integrity before it is read, and unpacked into node_modules in the workspace. No script runs and nothing is executed; entries that are not registry tarballs refuse the install. Never overwrites an existing node_modules.",
      parameters: Type.Object({
        lockfile: Path("Lockfile path in the workspace (default: package-lock.json inside `dir`)."),
        dir: Path("Workspace directory that receives node_modules (default: the workspace root)."),
        include: Include,
      }),
      execute: (input, context) => installVerified(input, { workspace: where(), fetch, signal: context?.signal }),
    },
    {
      name: "npm_audit",
      description:
        "Check the exact name@version pairs of a package-lock.json against the npm registry's advisory database and return a bounded summary. An unreachable or malformed registry answer is an error, never a clean result.",
      parameters: Type.Object({ lockfile: Path("Lockfile path in the workspace (default: package-lock.json)."), include: Include }),
      execute: (input, context) => auditLockfile(input, { workspace: where(), fetch, signal: context?.signal }),
    },
  ];
}

export function registerNpmSuite(pi, options: { workspace?: NpmWorkspace; fetch?: FetchLike } = {}) {
  registerOperations(pi, npmOperationDescriptors(options));
}
