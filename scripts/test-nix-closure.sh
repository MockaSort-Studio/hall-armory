#!/usr/bin/env bash
set -euo pipefail

package_path=${1:?usage: test-nix-closure.sh <suite-path>}
manifest="$package_path/manifest.json"
closure=$(jq -er '.native.closure | strings | select(length > 0)' "$manifest")
closure_path="$package_path/${closure#./}"

[ -f "$closure_path/flake.nix" ] || { echo "Missing Nix flake: $closure_path" >&2; exit 1; }
[ -f "$closure_path/flake.lock" ] || { echo "Missing Nix lock: $closure_path" >&2; exit 1; }

nix flake check "path:$closure_path"
out=$(nix build --no-link --print-out-paths "path:$closure_path#default")
bash "$(dirname "$0")/check-closure.sh" "$out"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
printf '{"operations":[]}' > "$tmp/input.json"
nix run "path:$closure_path#default" -- describe "$tmp/input.json" "$tmp/output.json"
jq -e '.operations | arrays' "$tmp/output.json" >/dev/null
