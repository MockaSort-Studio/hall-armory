#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
PACKAGE="$ROOT/collaboration/github"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

npm pack --pack-destination "$TMP" "$PACKAGE" >/dev/null 2>&1
TARBALL=$(find "$TMP" -maxdepth 1 -name 'mockasort-studio-pi-github-tools-*.tgz' -print -quit)
mkdir "$TMP/install"
cd "$TMP/install"
npm init --yes >/dev/null
npm install --ignore-scripts --legacy-peer-deps "$TARBALL" >/dev/null
PACKAGE_ROOT="$TMP/install/node_modules/@mockasort-studio/pi-github-tools"
test -f "$PACKAGE_ROOT/src/index.ts"
test ! -e "$PACKAGE_ROOT/flake.nix"
test ! -e "$PACKAGE_ROOT/guest-suite-build"
test ! -e "$PACKAGE_ROOT/guest-runner.ts"

cat > "$TMP/assert-tools.ts" <<'EOF'
export default function (pi) {
  const names = new Set(pi.getAllTools().map(tool => tool.name));
  for (const name of ["github_issue_view", "github_pull_request_review", "github_discussions_list"]) {
    if (!names.has(name)) throw new Error(`Missing GitHub tool: ${name}`);
  }
}
EOF

cd "$ROOT"
PI_OFFLINE=1 npx pi \
  --no-extensions --no-context-files --no-skills --no-prompt-templates --no-themes \
  -e "$TMP/install/node_modules/@mockasort-studio/pi-github-tools" \
  -e "$TMP/assert-tools.ts" --list-models --offline >/dev/null

echo "GitHub extension loads from an npm-packed clean installation"
