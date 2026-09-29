# Adding a suite

A suite is one installable Pi extension package, one co-located locked Nix
closure definition, and an explicit tool allowlist. Do not add per-tool
manifests, native archive URLs, or handler source outside the suite directory.

1. Add the suite manifest below a locker directory.
2. Add its index entry to `manifest.json`.
3. Set `extension` and `package` to the releasable Pi package identity.
4. Add `flake.nix` and its generated `flake.lock` at the suite root.
5. Set `native.closure` to `.`, allowing the flake to build the complete
   co-located suite source as well as its native dependencies.
6. Expose the guest suite runner as the Nix flake's default app. The app program
   is the exact store entrypoint; do not repeat command paths or input hashes
   in the suite manifest.
7. List every tool name the package may expose; preparation rejects undeclared
   selections.
8. Run `npm test` and `npm run validate`.

Nix owns native dependency identity and the derived closure. The release/cache
system publishes the resulting content-addressed closure artifact; it is not
checked into the suite source directory. The package owns its README, release
process, implementation, and Pi registration behavior.
