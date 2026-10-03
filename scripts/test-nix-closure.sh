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
# Guard the closure size: suites ship only what the guest lacks (see
# docs/guest-baseline.md). A regression that pulls a runtime back in fails here.
max_mb=${SUITE_MAX_CLOSURE_MB:-100}
size_mb=$(nix path-info -r --json --json-format 1 "$out" | jq '[.[].narSize] | add / 1000000 | floor')
echo "closure: ${size_mb} MB (limit ${max_mb} MB)"
[ "$size_mb" -le "$max_mb" ] || { echo "Closure exceeds ${max_mb} MB" >&2; exit 1; }
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
printf '{"operations":[]}' > "$tmp/input.json"
nix run "path:$closure_path#default" -- describe "$tmp/input.json" "$tmp/output.json"
jq -e '.operations | arrays' "$tmp/output.json" >/dev/null
