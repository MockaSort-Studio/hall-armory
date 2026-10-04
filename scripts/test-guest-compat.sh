#!/usr/bin/env bash
# Run a built suite on a stand-in for the Gondolin guest: Alpine (musl) with
# Node 24. Catches a dynamically linked binary, a glibc dependency, or Node
# coupling that a host-side build would never reveal.
#   test-guest-compat.sh <suite-path> <nix-system>      (needs docker)
set -euo pipefail

here=$(dirname "$0")
suite=${1:?usage: test-guest-compat.sh <suite-path> <nix-system>}
system=${2:?usage: test-guest-compat.sh <suite-path> <nix-system>}
out=$("$here/cache-suite.sh" "$suite" "$system" --print-out-paths)
"$here/check-closure.sh" "$out"
gh=$(nix path-info -r "$out" | grep -E -- '-gh-[0-9]')

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
chmod 777 "$tmp"
first_tool=$(jq -r '.tools[0]' "$suite/manifest.json")
printf '{"operations":["%s"]}' "$first_tool" > "$tmp/in.json"

guest() { docker run --rm -v /nix/store:/nix/store:ro -v "$tmp:/work" node:24-alpine "$@"; }
guest "$out/bin/armory-suite" describe /work/in.json /work/out.json
jq -e --arg tool "$first_tool" '.operations | length == 1 and .[0].name == $tool' "$tmp/out.json" >/dev/null
guest "$gh/bin/gh" --version | grep -q '^gh version'
echo "guest compat OK: describe and gh run on Alpine/musl with Node 24"
