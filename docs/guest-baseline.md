# Guest baseline

A suite closure contains only what the Gondolin guest lacks. The guest image
(pinned by the Hall CLI's exact Gondolin version) provides:

- Alpine Linux (musl libc), `sh` (busybox), `curl`
- Node.js 24 at `/usr/bin/node`

So a suite ships its bundled JavaScript runner (esbuild, no runtime references)
plus any tool the guest does not have, preferably as a static binary (musl guest,
no glibc). A glibc tool pays for glibc once; Nix shares it across suites.

The GitHub suite is the runner bundle plus the upstream static `gh` release
(sha256-pinned): about 40 MB, instead of the 350 MB closure that shipped Node,
glibc, icu, bash and header outputs. `scripts/test-nix-closure.sh` fails if a
closure exceeds `SUITE_MAX_CLOSURE_MB` (default 100).

What a tool does at runtime (workspaces, downloads, caches, network) is the
tool's and the guest policy's concern, not the suite's.
