#!/usr/bin/env bash
set -euo pipefail

package_path=${1:?usage: test-nix-closure.sh <suite-path>}
manifest="$package_path/manifest.json"
closure=$(jq -er '.native.closure | strings | select(length > 0)' "$manifest")
closure_path="$package_path/${closure#./}"

[ -f "$closure_path/flake.nix" ] || { echo "Missing Nix flake: $closure_path" >&2; exit 1; }
[ -f "$closure_path/flake.lock" ] || { echo "Missing Nix lock: $closure_path" >&2; exit 1; }

nix flake check "path:$closure_path"
nix build --no-link "path:$closure_path#default"
