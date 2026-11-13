# @mockasort-studio/pi-npm-tools

Two host-side operations for installing and auditing a project's npm dependencies **exactly as its lockfile locks
them**, without running anything from those dependencies. The package is Crew-agnostic: any Pi host can use it.

| Operation              | What it does                                                                                                                                                                                                                                                                                                                                       |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm_install_verified` | Reads `package-lock.json` (v2 or v3), downloads every locked tarball from `registry.npmjs.org`, checks each against the lockfile's `sha512` integrity **before reading it**, and unpacks the tree into `node_modules` in the workspace. No script runs, no `.bin` links are created, an existing `node_modules` is never overwritten (the final `mkdir` is the check). |
| `npm_audit`            | Sends the lockfile's exact `name@version` pairs to the registry's advisory endpoint and returns a bounded summary. A registry that cannot be reached or answers unexpectedly is an error, never a clean result.                                                                                                                                    |

## Guarantees

- Only `https://registry.npmjs.org/...` tarball URLs are accepted: no other host, lookalike host, userinfo, port,
  `http`, git or file source. Redirects are not followed.
- Every archive is hashed and compared with the lockfile's single `sha512` integrity value before it is read.
- Every archive entry shares one top-level directory (npm's `package/`, stripped as npm does). Names that a
  filesystem may fold together (case, Unicode normalization, trailing dots or spaces) collide, within an archive
  and across the whole install: no package may write where another's file belongs.
- Only regular files and directories are unpacked. Links, devices, absolute or `..` paths, backslashes, duplicate or
  colliding entries, directories with data, and truncated, corrupt or unterminated archives refuse the install.
  A symbolic link in the destination path is refused.
- Bounds (hard refusals, not truncation): 32 MiB per download, 128 MiB per unpacked archive, 256 MiB and 20,000
  entries per install, 4,000 packages, 16 MiB lockfile (checked by size before it is read). Memory stays within about
  520 MiB: four compressed downloads in flight, one archive unpacked at a time within the remaining budget, and at
  most the 256 MiB budget kept.
- Nothing is written until the whole tree has passed; a failed write removes what was created. Optional packages that
  fail are reported in `skipped`; any other failure aborts.
- Links and workspaces in the lockfile are not installable and refuse the install. Bundled and (with
  `include: "production"`) development packages are skipped and reported.
- Run a binary with `node node_modules/<package>/<path>`; the suite creates no `.bin` links.

## Where it runs

Both operations run **host-side**: they reach the registry and write into a workspace the host holds. The Nix guest
runner (`guest-suite-build/`, required by the catalog) only describes them; invoking one in a guest is an error, since a
guest has no registry access.

## Host injection

`activateSuite(pi, { workspace, fetch })`: `workspace` is `{ fs, dir }` with promise-style `fs` (under `.promises`, as
`node:fs` has) and the working-tree root; `fetch` defaults to the global `fetch`. Without injection the process
filesystem at `/workspace` is used. The suite needs no credential.

## Test

```sh
npm test
```
