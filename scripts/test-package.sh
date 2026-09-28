#!/usr/bin/env bash
set -euo pipefail

package=$1
node --test "$package"/test/*.test.mjs
bash "$package"/test-install.sh
