#!/usr/bin/env bash
# Build one suite's guest output for a Linux guest system.
#   cache-suite.sh <suite-path> <nix-system> [extra nix build flags...]
# FLAKE_BASE (e.g. github:Owner/repo/<sha>) selects a remote flake, as a Hall
# client would; unset builds the local checkout.
set -euo pipefail

suite=${1:?usage: cache-suite.sh <suite-path> <nix-system> [nix build flags]}
system=${2:?usage: cache-suite.sh <suite-path> <nix-system> [nix build flags]}
shift 2
manifest="$suite/manifest.json"
closure=$(jq -er '.native.closure | strings | select(length > 0)' "$manifest")
output=$(jq -er '.native.output | strings | select(length > 0)' "$manifest")

dir=${suite%/}
[ "$closure" = "." ] || dir="$dir/${closure#./}"
ref=${FLAKE_BASE:+$FLAKE_BASE?dir=$dir}
ref=${ref:-path:$PWD/$dir}

exec nix build --no-link "$@" "$ref#packages.$system.$output"
