# Hall Armory

Hall Armory is the declarative catalog of extension suites approved for Hall
sandbox preparation and the home of their independently releasable extension
packages. It is not a general extension manager.

A Crew profile selects a suite and a subset of its declared tools. The host
preparation layer resolves the suite's co-located, locked Nix closure and
mounts its derived immutable layer only when preparation is approved.

## Layout

```text
manifest.json                    # lockers and suite index
collaboration/github/             # suite manifest and releasable GitHub package
```

Each suite manifest identifies one independently installable Pi package, a
relative `native.closure` directory, and its exact tool allowlist. For a
complete suite, `native.closure` is normally `.`: the suite root contains
`flake.nix` and `flake.lock`, so Nix can build the co-located extension source
and dependency graph as well as native tools. Package source, schemas, and
registration handlers are co-located with that suite; Crew runtime accessors
do not belong in this repository.

## Guest suite runner

A suite flake's default app is a **guest suite runner**: a one-shot executable
built by Nix alongside the suite implementation, its locked dependencies, and
native closures. It is neither a Pi process nor a daemon. It gives Env one
uniform guest-side ABI:

```text
describe(approved operation names) -> operation metadata and input schemas
invoke(approved operation name, typed input) -> structured result or error
```

The host Pi worker receives only the metadata needed to register a generic,
session-local proxy. On a call, that proxy asks Env to invoke the runner in the
worker's private guest. The runner then loads the suite implementation and may
call its guest-native tools. It prevents host Pi from importing suite code,
loading its dependencies, or executing native binaries.

A direct native command is insufficient: suites may contain validation and
higher-level extension logic. New suites must therefore expose the same runner
contract even when their first operation is a thin CLI wrapper.

## Development

```sh
npm test
npm run validate
```

The test suite verifies catalog shape, safe manifest paths, unique names,
source isolation, package behavior, and packed-install Pi loading.

## Adding a suite

See [docs/adding-a-suite.md](docs/adding-a-suite.md). Every change must pass
validation and be reviewed before it can become available to sandbox profiles.

## License

GPL-3.0-only. See [LICENSE](LICENSE).

## Binary cache

`.github/workflows/cache.yml` builds every cataloged suite's Linux guest output
(`x86_64-linux`, `aarch64-linux`) and, on `main` only, pushes it to the Cachix
cache named by the `CACHIX_CACHE_NAME` repository variable (token in the
`CACHIX_AUTH_TOKEN` secret). After each push, macOS and Linux runners fetch the
same artifacts with `--max-jobs 0`, proving clients substitute rather than build.

Client setup (one-time, needs root; add to `/etc/nix/nix.custom.conf`):

```
extra-substituters = https://<cache>.cachix.org
extra-trusted-public-keys = <cache>.cachix.org-1:<public key>
```

`scripts/cache-suite.sh <suite-path> <nix-system>` reproduces any CI build locally.
