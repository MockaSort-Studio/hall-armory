# Adding a suite

A suite is one installable Pi extension package with one native requirement and
an explicit tool allowlist. Do not add per-tool manifests or handler source.

1. Add a suite manifest below a locker directory.
2. Add its index entry to `manifest.json`.
3. Set `extension` to the package's extension name and `package` to its npm
   package name.
4. Declare the native command, system probe, and verified cache fallbacks.
5. List every tool name the package may expose; the preparation layer rejects
   undeclared selections.
6. Run `npm test` and `npm run validate`.

The package itself owns its README, release process, implementation, and Pi
registration behavior. This repository only approves metadata used during
sandbox preparation.
