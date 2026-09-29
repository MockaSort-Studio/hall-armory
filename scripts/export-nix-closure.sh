#!/usr/bin/env bash
set -euo pipefail

suite_path=${1:?usage: export-nix-closure.sh <suite-path> <output-dir>}
output_dir=${2:?usage: export-nix-closure.sh <suite-path> <output-dir>}
manifest="$suite_path/manifest.json"
closure=$(jq -er '.native.closure | strings | select(length > 0)' "$manifest")
flake="path:$suite_path/${closure#./}"

[ ! -e "$output_dir" ] || { echo "Closure artifact already exists: $output_dir" >&2; exit 1; }
mkdir -p "$(dirname "$output_dir")"
root=$(nix build --no-link --print-out-paths "$flake#default")
work=$(mktemp -d "${output_dir}.tmp-XXXXXX")
trap 'rm -rf "$work"' EXIT
nix path-info --recursive --json --json-format 1 "$root" > "$work/paths.json"
nix-store --export "$root" | zstd --threads=0 --quiet -o "$work/closure.nar.zst"
sha256=$(sha256sum "$work/closure.nar.zst" | cut -d' ' -f1)

jq -n \
  --arg root "$root" \
  --arg sha256 "$sha256" \
  --slurpfile pathInfo "$work/paths.json" \
  '{format:"hall.armory-nix-closure/v1", rootPath:$root, nar:"closure.nar.zst", sha256:$sha256, paths:($pathInfo[0] | keys | sort)}' \
  > "$work/closure.json"

mv "$work" "$output_dir"
trap - EXIT
