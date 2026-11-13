# @mockasort-studio/pi-npm-tools

Two host-side operations for installing and auditing a project's npm dependencies **exactly as its lockfile locks
them**, without running anything from those dependencies. The package is Crew-agnostic: any Pi host can use it.

| Operation              | What it does                                                                                                                                                                                                                                                                                                                                       |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm_install_verified` | Reads `package-lock.json` (v2 or v3), downloads every locked tarball from `registry.npmjs.org`, checks each against the lockfile's `sha512` integrity **before reading it**, and unpacks the tree into `node_modules` in the workspace. No script runs, no `.bin` links are created, an existing `node_modules` is never overwritten. |
| `npm_audit`            | Sends the lockfile's exact `name@version` pairs to the registry's advisory endpoint and returns a bounded summary. A registry that cannot be reached or answers unexpectedly is an error, never a clean result.                                                                                                                                    |

## Guarantees

- Only `https://registry.npmjs.org/...` tarball URLs are accepted: no other host, lookalike host, userinfo, port,
  `http`, git or file source. Redirects are not followed.
- Every archive is hashed and compared with the lockfile's single `sha512` integrity value before it is read.
- Only regular files and directories are unpacked. Links, devices, absolute or `..` paths, backslashes, duplicate or
  case-colliding entries and truncated or corrupt archives refuse the install.
- Bounds (hard refusals, not truncation): 32 MiB per download, 128 MiB per unpacked archive, 256 MiB and 20,000
  entries per install, 4,000 packages, 16 MiB lockfile.
- Nothing is written until the whole tree has passed; a failed write removes what was created. Optional packages that
  fail are reported in `skipped`; any other failure aborts.
- Links and workspaces in the lockfile are not installable and refuse the install. Bundled and (with
  `include: "production"`) development packages are skipped and reported.
- Run a binary with `node node_modules/<package>/<path>`; the suite creates no `.bin` links.

## Host injection

`activateSuite(pi, { workspace, fetch })`: `workspace` is `{ fs, dir }` with promise-style `fs` (under `.promises`, as
`node:fs` has) and the working-tree root; `fetch` defaults to the global `fetch`. Without injection the process
filesystem at `/workspace` is used. The suite needs no credential.

## Test

```sh
npm test
```
