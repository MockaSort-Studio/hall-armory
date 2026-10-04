#!/usr/bin/env bash
# Fail if a built suite closure is oversized or re-ships a runtime the guest
# already provides (see docs/guest-baseline.md).
#   check-closure.sh <store-path>      SUITE_MAX_CLOSURE_MB overrides the 100 MB limit
set -euo pipefail

out=${1:?usage: check-closure.sh <store-path>}
max_mb=${SUITE_MAX_CLOSURE_MB:-100}
closure=$(nix path-info -r --json --json-format 1 "$out")
size_mb=$(jq '[.[].narSize] | add / 1000000 | floor' <<<"$closure")
paths=$(jq -r 'keys[] | sub("^/nix/store/[a-z0-9]{32}-"; "")' <<<"$closure")

echo "closure: ${size_mb} MB (limit ${max_mb} MB), $(wc -l <<<"$paths" | tr -d ' ') paths"
sed 's/^/  /' <<<"$paths"
[ "$size_mb" -le "$max_mb" ] || { echo "Closure exceeds ${max_mb} MB" >&2; exit 1; }
if forbidden=$(grep -E '^(nodejs|nodejs-slim|glibc|bash|bash-interactive|python3|icu4c)(-[0-9]|$)' <<<"$paths"); then
  echo "Closure re-ships a runtime the guest provides:" >&2; echo "$forbidden" >&2; exit 1
fi
