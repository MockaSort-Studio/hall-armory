#!/usr/bin/env bash
set -euo pipefail

npm --prefix "$1" test
