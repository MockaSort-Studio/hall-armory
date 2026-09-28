# Hall Armory

Hall Armory is the declarative catalog of extension suites approved for Hall
sandbox preparation and the home of their independently releasable extension
packages. It is not a general extension manager.

A Crew profile selects a suite and a subset of its declared tools. The host
preparation layer then resolves the suite's native requirement system-first,
using a verified cache/fetch fallback only when preparation is approved.

## Layout

```text
manifest.json                       # lockers and suite index
collaboration/github/manifest.json    # package/native/tool metadata
extensions/collaboration/github/      # releasable GitHub Pi extension package
```

Each suite manifest identifies one independently installable Pi package, its
native requirement, and its exact tool allowlist. Package source, schemas, and
registration handlers live below `extensions/`; Crew runtime accessors do not.

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
