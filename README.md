# Hall Armory

Hall Armory is the declarative catalog of extension suites approved for Hall
sandbox preparation. It is not an extension manager and contains no extension
handler code.

A Crew profile selects a suite and a subset of its declared tools. The host
preparation layer then resolves the suite's native requirement system-first,
using a verified cache/fetch fallback only when preparation is approved.

## Layout

```text
manifest.json                    # lockers and suite index
collaboration/github/manifest.json # one suite's package/native/tool metadata
```

Each suite manifest identifies one independently installable Pi package, its
native requirement, and its exact tool allowlist. Package source, schemas, and
registration handlers live in their owning code repository.

## Development

```sh
npm test
npm run validate
```

The test suite verifies catalog shape, safe manifest paths, unique names, and
that no executable package source has entered this catalog repository.

## Adding a suite

See [docs/adding-a-suite.md](docs/adding-a-suite.md). Every change must pass
validation and be reviewed before it can become available to sandbox profiles.

## License

GPL-3.0-only. See [LICENSE](LICENSE).
