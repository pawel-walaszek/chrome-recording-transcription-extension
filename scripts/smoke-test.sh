#!/usr/bin/env sh
set -eu

if command -v make >/dev/null 2>&1; then
  make check
else
  npm run check
fi
