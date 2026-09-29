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
